import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, withSession, apiCreateIssue } from './helpers/auth';

// Linear interaction parity (hourly review): row click opens the issue page, Space peeks, the created toast links to the issue,
// the status picker shows 1-6 and starts on the current status, a shown notification is read. Skipped in mock mode.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1 and the demo seed');

test('list: a click opens the full issue page, Space peeks in the side panel', async ({ page, browser }) => {
  await withSession(browser, page);
  const it = await apiCreateIssue(page, `Gap row ${Date.now()}`);
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  const row = page.locator(`[data-id="${it.id}"]`);
  await row.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Close detail panel' })).toBeHidden();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/w/${DEMO.slug}/issue/${it.identifier}$`));
});

test('status picker shows 1-6, starts on the current status and a digit picks', async ({ page, browser }) => {
  await withSession(browser, page);
  const it = await apiCreateIssue(page, `Gap status ${Date.now()}`);
  await page.goto(`/w/${DEMO.slug}/issue/${it.identifier}`); await page.waitForSelector('html[data-ready]');
  await page.getByRole('button', { name: /Backlog|Todo/ }).first().click();
  const list = page.getByRole('listbox', { name: 'Change status' });
  await expect(list.getByRole('option')).toHaveCount(6);
  await expect(list.getByRole('option').nth(5).locator('kbd')).toHaveText('6');
  const input = page.getByRole('combobox', { name: 'Filter: Change status' });
  const checked = list.getByRole('option', { selected: true });
  await expect(input).toHaveAttribute('aria-activedescendant', (await checked.getAttribute('id')) ?? '');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.keyboard.press('3');
  expect((await saved).ok()).toBeTruthy();
});

test('creating an issue shows a clickable View issue in the toast', async ({ page, browser }) => {
  await withSession(browser, page);
  await page.keyboard.press('c');
  await page.getByRole('textbox', { name: /title/i }).first().fill(`Gap toast ${Date.now()}`);
  await page.keyboard.press('Control+Enter');
  const toast = page.locator('.toast');
  await expect(toast).toContainText(/Created [A-Z]+-\d+/);
  await toast.getByRole('link', { name: 'View issue' }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/issue\/[A-Z]+-\d+$/);
});
