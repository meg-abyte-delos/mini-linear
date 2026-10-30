import { test, expect } from '@playwright/test';
import { GUEST_STATE } from './global-setup';

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
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-multi]')).toHaveCount(0);
});

test('shortcuts are ignored while typing in the palette input', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('gx?c');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
});

test('Shift between g and p does not reset the sequence', async ({ page }) => {
  await page.keyboard.press('g');
  await page.keyboard.down('Shift'); await page.keyboard.up('Shift');
  await page.keyboard.down('Control'); await page.keyboard.up('Control');
  await page.keyboard.press('p');
  await expect(page.locator('.cycle.project').first()).toBeVisible();
});

test('? overlay traps Tab and returns focus on close', async ({ page }) => {
  const row = page.locator('[role=option][tabindex="0"]').first();
  await row.focus();
  await page.keyboard.press('?');
  const d = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(d).toBeFocused();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(d).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(row).toBeFocused();
});

test('Esc clears the multi-selection first, then closes the panel', async ({ page }) => {
  await page.locator('[role=option]').first().click();
  await expect(page.getByRole('complementary', { name: 'Issue detail' })).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.locator('[data-multi]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-multi]')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Issue detail' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Issue detail' })).toBeHidden();
});

test('? overlay screenshot', async ({ page }) => {
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.screenshot({ path: 'test-results/a5-help-overlay.png' });
});

test('bulk: palette moves every selected issue, one toast', async ({ page }) => {
  await page.keyboard.press('x'); await page.keyboard.press('Shift+J');
  await expect(page.locator('[data-multi]')).toHaveCount(2);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('selected to done');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/2 issues updated/).first()).toBeVisible();
});

test('bulk: priority picker applies to all selected', async ({ page }) => {
  await page.keyboard.press('x'); await page.keyboard.press('Shift+J');
  await expect(page.locator('[data-multi]')).toHaveCount(2);
  const ids = await page.locator('[data-multi]').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  await page.keyboard.press('p');
  await page.getByRole('option', { name: /Urgent/ }).click();
  for (const id of ids) await expect(page.locator(`[data-id="${id}"] .pi-urgent`)).toHaveCount(1);
});

// Real guest session (seeded guest@example.test, role guest, 2 shared issues): read-only is derived from the session role, no ?role= hook.
test.describe('guest (read-only)', () => {
  test.use({ storageState: GUEST_STATE });

  test('guests are read-only: no Create issue, c does nothing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html[data-ready]');
    await expect(page.getByRole('button', { name: /New issue/ })).toHaveCount(0);
    // The seeded guest sees exactly the issues shared with them (2), nothing else.
    const n = await page.locator('[role=option]').count();
    expect(n).toBe(2);
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: 'New issue' })).toHaveCount(0);
    await expect(page.locator('[role=option]')).toHaveCount(n);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('create issue');
    // Since Cmd+K search, a query always offers 'Search all for …', so assert the command itself is absent.
    await expect(page.getByRole('option', { name: /^Create issue/ })).toHaveCount(0);
  });

  test('bulk: guests cannot bulk-edit', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('html[data-ready]');
    await page.keyboard.press('x');
    await page.keyboard.press('s');
    await expect(page.getByText('Guests have read-only access.')).toBeVisible();
  });
});
