import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const axe = async (page: import('@playwright/test').Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} x${v.nodes.length}`), label).toEqual([]);
};

test('loading: skeleton status shown, then the list', async ({ page }) => {
  await page.goto('/?state=loading', { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: 'Loading issues' })).toBeVisible();
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('status', { name: 'Loading issues' })).toHaveCount(0);
});

test('error: fixed message, Retry keeps ?state (persistent failure), plain URL recovers, axe clean', async ({ page }) => {
  await page.goto('/?state=error');
  await page.waitForSelector('html[data-ready]');
  const alert = page.locator('.state.error');
  await expect(alert).toContainText('Could not load issues');
  await axe(page, 'error');
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page).toHaveURL(/state=error/);
  await expect(alert).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expect(page.locator('.state.error')).toHaveCount(0);
});

test('empty: message, create button adds an issue, board columns say No issues, axe clean', async ({ page }) => {
  await page.goto('/?state=empty');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('status')).toContainText('No issues yet');
  await axe(page, 'empty');
  await page.getByRole('button', { name: /Create issue/ }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.getByText('No issues', { exact: true }).first()).toBeVisible();
  await axe(page, 'board-sparse');
});
