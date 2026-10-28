import { test, expect } from '@playwright/test';

test('projects view lists projects with progress and drills into issues', async ({ page }) => {
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  await expect(page.locator('.cycle.project')).toHaveCount(2);
  await page.locator('.cycle.project[data-project="p2"]').getByRole('button', { name: 'View issues' }).click();
  await expect(page).toHaveURL(/project=p2/);
  await expect(page.getByRole('button', { name: /^Project: Cronkit/ })).toBeVisible();
});

test('palette: Go to project, Assign to me, Copy issue id', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('assign to me');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Assigned to /)).toBeVisible();
  const id = (await page.locator('.row[aria-selected="true"] .id').first().textContent())!;
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('copy issue id');
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Copied ${id}`)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('go to project…');
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /^Mini Linear/ }).click();
  await expect(page).toHaveURL(/project=p1/);
});
