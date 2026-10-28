import { test, expect } from '@playwright/test';

test('Cmd+K lists matching issues under the commands and Enter opens the issue', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search commands' });
  await box.fill('cronkit');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list.getByRole('option', { name: /Cronkit parser port/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /Search all for/ })).toBeVisible();
  await list.getByRole('option', { name: /Cronkit parser port/ }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Issue detail' }).getByText('Cronkit parser port')).toBeVisible();
});

test('Search all goes to /search with the query and lists results', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('cronkit');
  await page.getByRole('option', { name: /Search all for/ }).click();
  await expect(page).toHaveURL(/\/search\?q=cronkit/);
  const results = page.getByRole('list', { name: 'Results' });
  await expect(results.getByRole('listitem').first()).toContainText('Cronkit parser port');
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.getByText(/No results/)).toBeVisible();
});

test('/search shows hint for short query and empty state for no match', async ({ page }) => {
  await page.goto('/search?q=a');
  await expect(page.getByText(/at least 2 characters/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Search' }).fill('zzzzqqq');
  await expect(page.getByText(/No results for/)).toBeVisible();
});

test('/search result link opens the issue detail', async ({ page }) => {
  await page.goto('/search?q=cronkit');
  await page.getByRole('list', { name: 'Results' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\?issue=/);
  await expect(page.getByRole('complementary', { name: 'Issue detail' }).getByText('Cronkit parser port')).toBeVisible();
});
