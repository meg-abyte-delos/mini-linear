import { test, expect } from '@playwright/test';

// The team-scoped list hides issues whose team_id differs from the selected team, and shows one with no team_id in every team (mock perf fixture only).
// Real API issues must always carry team_id: lock it on the list and on the single GET.
test('issues list and GET always return team_id', async ({ page }) => {
  const teams = (await (await page.request.get('/api/v1/w/demo/teams')).json()).items as { id: string }[];
  const team = teams[0]!;
  const made = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: team.id, title: `team_id contract ${Date.now()}` } });
  expect(made.status()).toBe(201);
  const it = (await made.json()) as { id: string; team_id: string };
  expect(it.team_id).toBe(team.id);
  const list = (await (await page.request.get('/api/v1/w/demo/issues?limit=100')).json()) as { items: { id: string; team_id?: string | null }[] };
  expect(list.items.length).toBeGreaterThan(0);
  for (const i of list.items) expect(i.team_id, `issue ${i.id} has no team_id`).toMatch(/^[0-9a-f-]{36}$/);
  expect(list.items.find((i) => i.id === it.id)?.team_id).toBe(team.id);
  const got = (await (await page.request.get(`/api/v1/w/demo/issues/${it.id}`)).json()) as { team_id?: string | null };
  expect(got.team_id).toBe(team.id);
});
