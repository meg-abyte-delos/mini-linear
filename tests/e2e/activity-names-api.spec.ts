import { test, expect, type APIRequestContext } from '@playwright/test';

// The activity feed names what changed (people, projects, cycles, labels, states) and refreshes after an edit without a reload. API mode, demo session.
const stamp = Date.now().toString(36);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const etag = (v: number) => String.fromCharCode(34) + v + String.fromCharCode(34);

async function patch(req: APIRequestContext, id: string, version: number, data: object) {
  const r = await req.patch(`/api/v1/w/demo/issues/${id}`, { data, headers: { 'If-Match': etag(version) } });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { version: number }).version;
}

// DELETE needs If-Match with the current version (see deleteProject/deleteIssue): read it first, then assert the delete landed.
async function del(req: APIRequestContext, path: string) {
  const cur = await req.get(path);
  if (!cur.ok()) return;
  const v = ((await cur.json()) as { version: number }).version;
  expect((await req.delete(path, { headers: { 'If-Match': etag(v) } })).status()).toBeLessThan(300);
}

test('rendered feed shows names, never raw ids, for assignee/project/cycle/labels/status', async ({ page }) => {
  const req = page.request;
  const teams = (await (await req.get('/api/v1/w/demo/teams')).json()).items as { id: string }[];
  const me = (await (await req.get('/api/v1/me')).json()) as { id: string };
  const members = ((await (await req.get('/api/v1/w/demo/members?limit=100')).json()) as { items: { user_id: string; email: string; display_name?: string | null }[] }).items;
  // Seeded fixture: mate@example.test has display_name 'Ada Kernel' (/members itself returns no display name).
  const other = members.find((m) => m.email === 'mate@example.test' && m.user_id !== me.id)!;
  const otherName = 'Ada Kernel';

  const project = (await (await req.post('/api/v1/w/demo/projects', { data: { name: `Feed project ${stamp}`, team_ids: [teams[0]!.id] } })).json()) as { id: string };
  const label = (await (await req.post('/api/v1/w/demo/labels', { data: { name: `feed-label-${stamp}`, team_id: null } })).json()) as { id: string };
  const year = 2100 + (parseInt(stamp.slice(-3), 36) % 700);
  const cyc = await req.post('/api/v1/w/demo/cycles', { data: { team_id: teams[0]!.id, name: `Feed cycle ${stamp}`, start_date: `${year}-01-01`, end_date: `${year}-01-14` } });
  expect(cyc.status()).toBe(201);
  const cycle = (await cyc.json()) as { id: string };

  const created = await req.post('/api/v1/w/demo/issues', { data: { team_id: teams[0]!.id, title: `Feed names ${stamp}` } });
  expect(created.status()).toBe(201);
  const it = (await created.json()) as { id: string; identifier: string; version: number };
  let v = it.version;
  v = await patch(req, it.id, v, { assignee_id: other.user_id });
  v = await patch(req, it.id, v, { project_id: project.id });
  v = await patch(req, it.id, v, { cycle_id: cycle.id });
  v = await patch(req, it.id, v, { label_ids: [label.id] });
  await patch(req, it.id, v, { status: 'in_progress' });

  // This file runs first in the full build-test suite (shared DB): leave no extra project/cycle/label/issue behind for dnd/projects specs.
  try {
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText(`set assignee to ${otherName}`);
  await expect(feed).toContainText(`set project to Feed project ${stamp}`);
  await expect(feed).toContainText(`set cycle to Feed cycle ${stamp}`);
  await expect(feed).toContainText(`added feed-label-${stamp}`);
  await expect(feed).toContainText('changed status from Backlog to In Progress');
  const items = await feed.getByRole('listitem').allInnerTexts();
  expect(items.length).toBeGreaterThanOrEqual(5);
  for (const t of items) expect(t).not.toMatch(UUID);
  } finally {
    await del(req, `/api/v1/w/demo/issues/${it.id}`);
    await del(req, `/api/v1/w/demo/projects/${project.id}`);
    await del(req, `/api/v1/w/demo/cycles/${cycle.id}`);
    await del(req, `/api/v1/w/demo/labels/${label.id}`);
  }
});

test('feed refreshes after an edit without a reload: server wording replaces the optimistic entry', async ({ page }) => {
  const teams = (await (await page.request.get('/api/v1/w/demo/teams')).json()).items as { id: string }[];
  const old = `Feed refresh ${stamp}`;
  const created = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams[0]!.id, title: old } });
  const it = (await created.json()) as { id: string; identifier: string };
  try {
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const t = page.getByLabel('Title', { exact: true });
  await t.fill(`${old} edited`);
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await t.press('Enter');
  expect((await saved).ok()).toBe(true);
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText(`changed title from ${old} to ${old} edited`, { timeout: 5000 });
  await expect(feed.getByText('changed the title', { exact: false })).toHaveCount(0);
  } finally {
    await del(page.request, `/api/v1/w/demo/issues/${it.id}`);
  }
});
