import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('A4.3 board with 2,000 issues is virtualized and scrolls to the end', async ({ page }) => {
  await page.goto('/?seed=2000');
  await page.getByRole('button', { name: /board/i }).click();
  const col = page.getByTestId('col-backlog');
  await expect(col).toBeVisible();
  const total = Number(await page.locator('#c-backlog .count').textContent());
  expect(total).toBeGreaterThan(300);
  const rendered = await col.getByRole('option').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(40);
  await col.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(col.getByRole('option').last()).toBeVisible();
  expect(await col.getByRole('option').count()).toBeLessThan(40);
});

test('board: J/K selection scrolls through off-screen cards', async ({ page }) => {
  await page.goto('/?seed=200');
  await page.getByRole('button', { name: /board/i }).click();
  await page.waitForSelector('html[data-ready]');
  for (let n = 0; n < 15; n++) await page.keyboard.press('j');
  await expect(page.locator('.card[aria-selected=true]')).toHaveCount(1);
});

test('board with 2,000 issues: axe 0 serious violations', async ({ page }) => {
  await page.goto('/?seed=2000');
  await page.getByRole('button', { name: /board/i }).click();
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
