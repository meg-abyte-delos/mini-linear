import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('filter by status is applied and written to the URL', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const before = await page.locator('.row').count();
  await page.getByRole('button', { name: /^Status/ }).click();
  await page.getByRole('option', { name: /^Todo/ }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/status=todo/);
  const after = await page.locator('.row').count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  await expect(page.getByRole('button', { name: /^Status: Todo/ })).toBeVisible();
});

test('filters load from the URL, combine, and clear', async ({ page }) => {
  await page.goto('/?status=todo,done&cycle=c1');
  await expect(page.getByRole('button', { name: /^Cycle: Cycle 1/ })).toBeVisible();
  const n = await page.locator('.row').count();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/status=|cycle=/);
  expect(await page.locator('.row').count()).toBeGreaterThan(n);
});

test('no match shows an empty state with a way out', async ({ page }) => {
  await page.goto('/?status=backlog&assignee=u5&label=l3&project=p2&cycle=c3');
  await expect(page.getByText('No issues match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.locator('.row').first()).toBeVisible();
});

test('filters survive a view switch and apply to the board', async ({ page }) => {
  await page.goto('/?status=todo');
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.locator('#c-todo .count')).not.toHaveText('0');
  await expect(page.locator('#c-backlog .count')).toHaveText('0');
  await expect(page).toHaveURL(/status=todo/);
});

test('cycles view groups active / upcoming / past and drills into issues', async ({ page }) => {
  await page.goto('/?today=2026-10-27');
  await page.getByRole('link', { name: 'Cycles' }).click();
  await expect(page.locator('[data-cycle=c2]')).toHaveAttribute('data-bucket', 'active');
  await expect(page.locator('[data-cycle=c3]')).toHaveAttribute('data-bucket', 'upcoming');
  await expect(page.locator('[data-cycle=c1]')).toHaveAttribute('data-bucket', 'past');
  await page.locator('[data-cycle=c2]').getByRole('button', { name: 'View issues' }).click();
  await expect(page).toHaveURL(/cycle=c2/);
  await expect(page.locator('.row').first()).toBeVisible();
});

test('filter bar and cycles view: axe 0 serious violations', async ({ page }) => {
  await page.goto('/?today=2026-10-27&status=todo');
  let r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.getByRole('link', { name: 'Cycles' }).click();
  r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
