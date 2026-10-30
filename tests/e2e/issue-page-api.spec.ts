import { test, expect } from '@playwright/test';

// Smoke on the seeded demo workspace with the demo session (storageState). Tess's fuller suite builds on this.
test('issue page on the API: renders, edits the title (If-Match) with activity, 404 for a workspace the user is not in', async ({ page }) => {
  // Own issue: the seeded titles are asserted by other specs on the shared DB.
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const created = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title: 'Issue page smoke' } });
  expect(created.status()).toBe(201);
  const it = (await created.json()) as { identifier: string; title: string };
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const t = page.getByLabel('Title', { exact: true });
  await expect(t).toHaveValue(it.title);
  await t.fill('Edited via API page');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await t.press('Enter');
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText(/changed (the )?title/);
  await page.reload();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Edited via API page');
  await page.goto('/w/not-mine/issue/DEM-1');
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
});
