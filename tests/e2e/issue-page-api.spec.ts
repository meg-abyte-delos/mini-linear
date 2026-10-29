import { test, expect } from '@playwright/test';

// Smoke on the seeded demo workspace with the demo session (storageState). Tess's fuller suite builds on this.
test('issue page on the API: renders, edits the title (If-Match) with activity, 404 for a workspace the user is not in', async ({ page }) => {
  const list = await (await page.request.get('/api/v1/w/demo/issues?limit=5')).json();
  const it = list.items[0];
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const t = page.getByLabel('Title', { exact: true });
  await expect(t).toHaveValue(it.title);
  await t.fill('Edited via API page'); await t.press('Enter');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('changed the title');
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Edited via API page');
  await page.goto('/w/not-mine/issue/DEM-1');
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
});
