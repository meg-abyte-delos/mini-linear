import { test, expect } from '@playwright/test';

test('Cmd+K lists matching issues above the commands and Enter opens the issue', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: 'Search commands' });
  await box.fill('cronkit');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list.getByRole('option', { name: /Cronkit parser port/ })).toBeVisible();
  await expect(list.getByRole('option', { name: /Search all for/ })).toBeVisible();
  // Like Linear: search hits sit above the actions, so the first option is a hit, never a command.
  await expect(list.getByRole('option').first()).toHaveAttribute('id', /^pc-hit-/);
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

// FIXME(PR 3, search): /search still runs on the mock (ML_API mode), so its result links carry mock ids that the API-backed home cannot open.
test.fixme('/search result link opens the issue detail', async ({ page }) => {
  await page.goto('/search?q=cronkit');
  await page.getByRole('list', { name: 'Results' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\?issue=/);
  await expect(page.getByRole('complementary', { name: 'Issue detail' }).getByText('Cronkit parser port')).toBeVisible();
});

test('Cmd+K with an empty query keeps actions first', async ({ page }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  const list = page.getByRole('listbox', { name: 'Commands' });
  await expect(list.getByRole('option').first()).toBeVisible();
  await expect(list.locator('[id^="pc-hit-"]')).toHaveCount(0);
});
