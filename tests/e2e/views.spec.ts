import { test, expect } from '@playwright/test';

test('priority filter, save as view, list in sidebar, reopen from shareable URL', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const total = await page.locator('.row').count();
  await page.locator('#fb-add').click();
  await page.getByRole('menuitem', { name: 'Priority' }).click();
  await page.getByRole('option', { name: /^Urgent/ }).click();
  await page.getByRole('combobox', { name: /Filter by priority/ }).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/priority=1/);
  expect(await page.locator('.row').count()).toBeLessThan(total);

  await page.getByRole('button', { name: 'Save view' }).click();
  const name = `Urgent only ${Date.now()}`; // unique: a failed earlier run on the persistent DB may have left its view behind
  await page.getByLabel('View name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const side = page.getByTestId('saved-views');
  await expect(side.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page).toHaveURL(/[?&]v=[0-9a-f-]{36}/);

  // Leave the view, then open it from the sidebar.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/priority=|v=/);
  await side.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/priority=1/);
  await expect(page.getByRole('button', { name: /^Priority: Urgent/ })).toBeVisible();

  // Editing the filters detaches from the saved view.
  await page.locator('#fb-add').click();
  await page.getByRole('menuitem', { name: 'Status' }).click();
  await page.getByRole('option', { name: /^Todo/ }).click();
  await page.getByRole('combobox', { name: /Filter by status/ }).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]v=/);

  await page.getByRole('button', { name: `Delete view ${name}` }).click();
  await expect(side.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
});

test('save needs a name', async ({ page }) => {
  await page.goto('/?status=todo');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.save-err')).toContainText('Enter a name');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('View name')).toHaveCount(0);
});
