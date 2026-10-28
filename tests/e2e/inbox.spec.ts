import { test, expect } from '@playwright/test';

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
