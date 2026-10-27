import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const first = (page: Page) => page.getByRole('option').first();
const detail = (page: Page) => page.getByRole('complementary', { name: 'Issue detail' });

test('P sets priority via popover, focus returns to the issue', async ({ page }) => {
  await page.goto('/');
  const id = (await first(page).getAttribute('data-id'))!;
  await first(page).focus();
  await page.keyboard.press('p');
  const dlg = page.getByRole('dialog', { name: 'Set priority' });
  await expect(dlg).toBeVisible();
  await page.keyboard.type('urg');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeHidden();
  await expect(page.locator(`[data-id="${id}"]`)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail(page)).toContainText('Urgent');
});

test('A assigns, Unassigned clears', async ({ page }) => {
  await page.goto('/');
  const id = (await first(page).getAttribute('data-id'))!;
  await first(page).focus();
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog', { name: 'Set assignee' })).toBeVisible();
  await page.keyboard.type('tess');
  await page.keyboard.press('Enter');
  await page.locator(`[data-id="${id}"]`).click();
  await expect(detail(page)).toContainText('Tess Tester');
  await page.locator(`[data-id="${id}"]`).focus();
  await page.keyboard.press('a');
  await page.keyboard.type('unas');
  await page.keyboard.press('Enter');
  await expect(detail(page)).toContainText('Unassigned');
});

test('L toggles labels, stays open, Esc closes; axe clean', async ({ page }) => {
  await page.goto('/');
  const id = (await first(page).getAttribute('data-id'))!;
  await first(page).focus();
  await page.keyboard.press('l');
  const dlg = page.getByRole('dialog', { name: 'Set labels' });
  await expect(dlg).toBeVisible();
  await page.keyboard.type('infra');
  await page.keyboard.press('Enter');
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('option', { name: /Infra/ })).toHaveAttribute('aria-selected', 'true');
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator(`[data-id="${id}"]`)).toBeFocused();
  await expect(page.locator(`[data-id="${id}"] .chip`, { hasText: 'Infra' })).toBeVisible();
});

test('palette Set priority opens the popover', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('set priority');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Set priority' })).toBeVisible();
});
