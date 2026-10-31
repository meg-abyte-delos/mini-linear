import { test, expect, type Page } from '@playwright/test';

// API mode (real Postgres, demo seed, demo session). Adapted from Tess's bulk-actions spec to the real SelectionBar.
test.describe.configure({ mode: 'serial' });
const home = async (page: Page) => { await page.goto('/'); await page.waitForSelector('html[data-ready]'); await expect(page.getByRole('option').first()).toBeVisible(); };

test('bulk: 2 selected shows the toolbar, Clear hides it', async ({ page }) => {
  await home(page);
  // A click on a row now opens the issue page (#351): select the first 2 rows with their checkboxes.
  const sel = page.getByRole('option').locator('[data-testid^="select-"]');
  await sel.nth(0).click(); await sel.nth(1).click();
  const bar = page.getByRole('toolbar', { name: /Bulk actions for 2 selected/ });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('2 selected');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar).toBeHidden();
});

test('bulk: priority on 2 issues goes through POST /issues/bulk and survives reload', async ({ page }) => {
  await home(page);
  // A click on a row now opens the issue page (#351): select the first 2 rows with their checkboxes.
  const sel = page.getByRole('option').locator('[data-testid^="select-"]');
  await sel.nth(0).click(); await sel.nth(1).click();
  await expect(page.locator('[data-multi]')).toHaveCount(2);
  const ids = await page.locator('[data-multi]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  const bulk = page.waitForResponse((r) => r.url().includes('/issues/bulk') && r.request().method() === 'POST');
  await page.keyboard.press('p');
  await page.getByRole('option', { name: /Urgent/ }).click();
  const res = await bulk;
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.succeeded).toHaveLength(2);
  expect(body.failed ?? []).toHaveLength(0);
  await page.reload(); await page.waitForSelector('html[data-ready]');
  for (const id of ids) await expect(page.locator(`[data-id="${id}"] .pi-urgent`)).toHaveCount(1);
});
