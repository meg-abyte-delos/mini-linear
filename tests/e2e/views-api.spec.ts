import { test, expect } from '@playwright/test';

// API mode (real Postgres, demo seed, demo session): saved views are server-side, not in-memory.
test.describe.configure({ mode: 'serial' });

test('saved view is persisted by the API: POST /views, survives reload, DELETE removes it server-side', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.locator('#fb-add').click();
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('option', { name: /^Urgent/ }).click();
  await page.getByRole('combobox', { name: /Filter by priority/ }).press('Escape');
  await expect(page).toHaveURL(/priority=1/);

  const name = `API view ${Date.now()}`;
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByLabel('View name').fill(name);
  const created = page.waitForResponse((r) => /\/views$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const row = await res.json();
  expect(row.name).toBe(name);

  // Fresh load of the unfiltered home: the view comes back from the server and reopens with its filters.
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const side = page.getByTestId('saved-views');
  await expect(side.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await side.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/priority=1/);

  const del = page.waitForResponse((r) => r.url().includes(`/views/${row.id}`) && r.request().method() === 'DELETE');
  await page.getByRole('button', { name: `Delete view ${name}` }).click();
  expect((await del).status()).toBeLessThan(300);
  const after = await page.request.get(`/api/v1/w/demo/views/${row.id}`);
  expect(after.status()).toBe(404);
});
