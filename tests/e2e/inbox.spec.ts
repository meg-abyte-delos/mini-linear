import { test, expect } from '@playwright/test';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// Own persona and inbox: other specs run as the admin and never touch these notifications.
test.use({ storageState: INBOX_STATE });

test.beforeEach(async () => { await resetInbox(); });

test('inbox: badge, keyboard triage', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByTestId('inbox-badge')).toHaveText('2');
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/view=inbox/);
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('j');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('u');
  await expect(page.getByTestId('inbox-badge')).toHaveText('1');
  await page.keyboard.press('e');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('k');
  await page.keyboard.press('h');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
});

test('inbox: mark all as read and empty state', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await expect(page.getByText('Inbox zero')).toBeVisible();
});

test('inbox: tabs, snooze menu, bulk archive, detail panel', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('complementary', { name: 'Notification detail' })).toContainText('DEM-1');
  await page.keyboard.press('s');
  await expect(page.getByRole('menu', { name: 'Snooze until' })).toBeVisible();
  await page.keyboard.press('2');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Snoozed' }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByTestId('select-DEM-2').click();
  await page.getByTestId('select-DEM-3').click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Inbox zero')).toBeVisible();
  await page.getByRole('tab', { name: 'Archived' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
});

test('inbox: x toggles selection of the focused notification', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('x');
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.getByText('1 selected')).toBeVisible();
});
