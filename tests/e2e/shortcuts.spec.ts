import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
});

test('? opens the shortcuts overlay from the registry, Esc closes it', async ({ page }) => {
  await page.keyboard.press('?');
  const d = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(d).toBeVisible();
  await expect(d.getByText('Go to projects')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

test('g then p / v / i navigates', async ({ page }) => {
  await page.keyboard.press('g'); await page.keyboard.press('p');
  await expect(page.locator('.cycle.project').first()).toBeVisible();
  await page.keyboard.press('g'); await page.keyboard.press('v');
  await expect(page.locator('.board')).toBeVisible();
  await page.keyboard.press('g'); await page.keyboard.press('i');
  await expect(page.locator('.board')).toBeHidden();
});

test('x toggles multi-select, Shift+J extends, Esc clears', async ({ page }) => {
  await page.keyboard.press('x');
  await expect(page.locator('[data-multi]')).toHaveCount(1);
  await page.keyboard.press('Shift+J');
  await expect(page.locator('[data-multi]')).toHaveCount(2);
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-multi]')).toHaveCount(0);
});

test('shortcuts are ignored while typing in the palette input', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('gx?c');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
});
