import { test, expect } from '@playwright/test';

// Regression: typing an NL phrase used to crash the page (TDZ on multiRef at render time).
test('palette NL action: assign + priority on the focused issue', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('option').first().click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('assign to Ada, high priority');
  const row = page.locator('li.nl-action');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Search commands' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('palette NL: a plain search phrase keeps search first', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('option').first().click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('fix for Ada');
  await expect(page.locator('li.nl-action')).toBeVisible();
  await expect(page.locator('li[aria-selected="true"]')).not.toHaveClass(/nl-action/);
});
