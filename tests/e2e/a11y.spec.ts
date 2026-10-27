import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('axe: no wcag2a/aa violations on list, palette, board', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  const scan = async (label: string) => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => `${label}: ${v.id} x${v.nodes.length}`), label).toEqual([]);
  };
  await scan('list');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox')).toBeFocused();
  await scan('palette');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /board/i }).click();
  await scan('board');
});

test('keyboard: roving j/k, palette trap, focus return', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('option').first().focus();
  await page.keyboard.press('j');
  await expect(page.getByRole('option', { selected: true })).toBeFocused();
  expect(await page.locator('[role=option][tabindex="0"]').count()).toBe(1);
  const before = await page.evaluate(() => document.activeElement?.getAttribute('data-id'));
  await page.keyboard.press('Control+k');
  const combo = page.getByRole('combobox');
  await expect(combo).toBeFocused();
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); expect(await inDialog()).toBe(true); }
  await page.keyboard.press('Shift+Tab');
  expect(await inDialog()).toBe(true);
  await combo.focus();
  await page.keyboard.press('ArrowDown');
  const ad = await combo.getAttribute('aria-activedescendant');
  expect(ad).toBeTruthy();
  await expect(page.locator(`#${ad}`)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-id'))).toBe(before);
});

test('Enter on a focused button does not open the detail panel', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const before = await page.locator('aside').count();
  await page.getByRole('button', { name: /board/i }).focus();
  await page.keyboard.press('Enter');
  expect(await page.locator('aside').count()).toBe(before);
});
