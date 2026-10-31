import { test, expect, type Page } from '@playwright/test';
import { API_MODE, DEMO, login } from './helpers/auth';

// Delete authorisation on teams (deleteTeam: workspace admin only). Real stack: the demo admin creates a throwaway team,
// the seeded non-admin member `mate` (mate@example.test) must get 403 on DELETE and the team must survive.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

const teamsUrl = `/api/v1/w/${DEMO.slug}/teams`;
const listTeamIds = async (page: Page) => {
  const res = await page.request.get(teamsUrl);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { items: { id: string }[] }).items.map((t) => t.id);
};
const randomKey = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

test('a member gets 403 on delete team, the team survives, and the admin can delete it', async ({ page, browser }) => {
  await login(page);
  const created = await page.request.post(teamsUrl, { data: { name: `authz-${Date.now()}`, key: randomKey() } });
  expect(created.status()).toBe(201);
  const team = (await created.json()) as { id: string };

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, 'mate@example.test');
  const denied = await mate.request.delete(`${teamsUrl}/${team.id}`);
  expect(denied.status()).toBe(403);
  await ctx.close();

  // Nothing was deleted.
  expect(await listTeamIds(page)).toContain(team.id);

  // Control: the admin can delete it (also cleans up the throwaway team).
  const ok = await page.request.delete(`${teamsUrl}/${team.id}`);
  expect(ok.status()).toBe(204);
  expect(await listTeamIds(page)).not.toContain(team.id);
});
