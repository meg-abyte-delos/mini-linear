import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const first = (page: Page) => page.getByRole('option').first();
const detail = (page: Page) => page.getByRole('complementary', { name: 'Issue detail' });

test('P sets priority via popover, focus returns to the issue', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
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

// The assignee picker flow runs on the API and real members: tests/e2e/members-assignee-api.spec.ts (assign + Unassigned clears).

test('L toggles labels, stays open, Esc closes; axe clean', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
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
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('set priority');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Set priority' })).toBeVisible();
});

test('single-select: aria-selected marks the current value, highlight follows activedescendant', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await first(page).focus();
  await page.keyboard.press('p');
  const dlg = page.getByRole('dialog', { name: 'Set priority' });
  const cur = await dlg.getByRole('option', { selected: true }).count();
  expect(cur).toBe(1);
  await page.keyboard.press('ArrowDown');
  await expect(dlg.getByRole('option', { selected: true })).toHaveCount(1);
  const active = await dlg.getByRole('combobox').getAttribute('aria-activedescendant');
  expect(await dlg.locator('[data-active=true]').getAttribute('id')).toBe(active);
  expect(await dlg.locator(`#${active}`).getAttribute('aria-selected')).not.toBe(null);
});

test('labels show on board cards and list rows', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const id = (await first(page).getAttribute('data-id'))!;
  await first(page).focus();
  await page.keyboard.press('l');
  const dlg = page.getByRole('dialog', { name: 'Set labels' });
  await expect(dlg).toBeVisible();
  await page.keyboard.type('infra');
  await page.keyboard.press('Enter');
  const opt = dlg.getByRole('option', { name: /Infra/ });
  if ((await opt.getAttribute('aria-selected')) !== 'true') await page.keyboard.press('Enter');
  await expect(opt).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator(`.row[data-id="${id}"] .chip`, { hasText: 'Infra' })).toBeVisible();
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.locator(`.card[data-id="${id}"] .chip`, { hasText: 'Infra' })).toBeVisible();
});
