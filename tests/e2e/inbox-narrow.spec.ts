import { test, expect, type Page } from '@playwright/test';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// Inbox at <=900px: the preview pane is hidden, so a row click opens the issue and j/k only move the cursor
// (they must not mark notifications read into a pane nobody sees). Wide behaviour is covered in inbox.spec.ts.
test.use({ storageState: INBOX_STATE, viewport: { width: 800, height: 800 } });

test.beforeEach(async () => { await resetInbox(); });

async function openInbox(page: Page) {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible(); // the list loads after hydration
}

test('inbox 800px: the preview pane is hidden and the list uses the full width', async ({ page }) => {
  await openInbox(page);
  await expect(page.getByRole('complementary', { name: 'Notification detail' })).toBeHidden();
  const l = await page.getByRole('listbox', { name: 'Notifications' }).boundingBox();
  expect(l!.x + l!.width).toBeLessThanOrEqual(800 + 1);
  expect(l!.width).toBeGreaterThan(600);
});

test('inbox 800px: j/k move the cursor without marking notifications read', async ({ page }) => {
  await openInbox(page);
  await expect(page.getByTestId('inbox-badge')).toHaveText('2');
  const unread = page.locator('[role=option][data-unread=true]');
  await expect(unread).toHaveCount(2);
  await page.keyboard.press('j');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('j');
  await expect(page.getByRole('option').nth(2)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('k');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-current', 'true');
  // nothing was marked read on the way
  await expect(page.getByTestId('inbox-badge')).toHaveText('2');
  await expect(unread).toHaveCount(2);
});

test('inbox 800px: a row click opens the issue (and reads it) instead of selecting into the hidden pane', async ({ page }) => {
  await openInbox(page);
  await expect(page.getByTestId('inbox-badge')).toHaveText('2');
  const row = page.locator('[role=option][data-unread=true]').first();
  await expect(row).toBeVisible();
  await row.click();
  // the Inbox view is replaced by the issue view
  await expect(page.getByRole('listbox', { name: 'Notifications' })).toHaveCount(0);
  await expect(page.getByTestId('inbox-badge')).toHaveText('1'); // opening reads it
});
