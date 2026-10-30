import { test, expect } from '@playwright/test';
import { API_MODE, DEMO } from './helpers/auth';

// Real stack: the list header names the team the list is scoped to, not the workspace.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

test('list breadcrumb shows the scoped team name', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const crumbs = page.locator('header.head .crumbs');
  await expect(crumbs).toContainText('Issues');
  await expect(crumbs).not.toContainText('Delos');
  const teams = (await (await page.request.get(`/api/v1/w/${DEMO.slug}/teams`)).json()) as { items: { id: string; name: string }[] };
  const home = teams.items.find((t) => t.id === DEMO.teamId);
  expect(home?.name).toBeTruthy();
  await expect(crumbs.locator('span').first()).toHaveText(home!.name);
});
