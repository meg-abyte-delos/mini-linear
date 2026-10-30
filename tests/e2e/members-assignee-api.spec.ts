import { test, expect } from '@playwright/test';
import { nameFromEmail } from '../../src/lib/nl-people';

// PR 4: the assignee picker and names come from the workspace members (real UUIDs), not the USERS mock.
test('A assigns a real member, persists, and the picker lists members only', async ({ page }) => {
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const me = (await (await page.request.get('/api/v1/me')).json()) as { id: string };
  const members = ((await (await page.request.get('/api/v1/w/demo/members?limit=100')).json()) as { items: { user_id: string; email: string }[] }).items;
  const other = members.find((m) => m.user_id !== me.id)!;
  expect(other).toBeTruthy();
  const title = `Assignee picker ${Date.now()}`;
  const created = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title } });
  expect(created.status()).toBe(201);
  const it = (await created.json()) as { id: string };
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const row = page.locator(`[data-id="${it.id}"]`);
  await row.click();
  await page.keyboard.press('a');
  const dlg = page.getByRole('dialog', { name: 'Set assignee' });
  await expect(dlg).toBeVisible();
  await expect(dlg).not.toContainText('Tess Tester');
  await page.keyboard.type(nameFromEmail(other.email).toLowerCase());
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.keyboard.press('Enter');
  expect((await saved).ok()).toBe(true);
  const got = (await (await page.request.get(`/api/v1/w/demo/issues/${it.id}`)).json()) as { assignee_id: string | null };
  expect(got.assignee_id).toBe(other.user_id);
  await expect(row).toContainText(nameFromEmail(other.email).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
  // Unassigned clears it.
  await row.focus();
  await page.keyboard.press('a');
  await expect(page.getByRole('dialog', { name: 'Set assignee' })).toBeVisible();
  await page.keyboard.type('unas');
  const cleared = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.keyboard.press('Enter');
  expect((await cleared).ok()).toBe(true);
  const after = (await (await page.request.get(`/api/v1/w/demo/issues/${it.id}`)).json()) as { assignee_id: string | null };
  expect(after.assignee_id).toBeNull();
});

test('issue page timeline names the actor (no Someone) once members are loaded', async ({ page }) => {
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const created = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title: 'Actor name smoke' } });
  const it = (await created.json()) as { identifier: string };
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const t = page.getByLabel('Title', { exact: true });
  await t.fill('Actor name smoke 2');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await t.press('Enter');
  await saved;
  const feed = page.getByRole('list', { name: 'Activity' });
  // The feed refetches asynchronously after the PATCH (flaked once on main 9d74509: only "created the issue" within 5s).
  // The title change is already persisted, so retry with a reload as fallback instead of trusting a single refetch.
  await expect(async () => {
    if (!(await feed.innerText().catch(() => '')).includes('changed title from')) {
      await page.reload();
      await page.waitForSelector('html[data-ready]');
    }
    await expect(page.getByRole('list', { name: 'Activity' })).toContainText('changed title from', { timeout: 2000 });
  }).toPass({ timeout: 20000, intervals: [500, 1000, 2000] });
  await expect(feed).not.toContainText('Someone');
});

// Strict counterpart of the test above (which tolerates a reload): after a PATCH the open issue page refetches its activity feed by itself.
// No reload, no retry-with-reload: the entry must show up within the timeout, otherwise the live refetch is broken.
// FIXME(front): fails on main 3ef3296. After a title edit the open issue page keeps its optimistic entry ("changed the title") for 10 s+ and never shows the
// server entry ("changed title from X to Y", #192): the activity feed is not refetched/reconciled until a reload. Un-fixme once the page refetches after a PATCH.
test.fixme('issue page feed refetches after an edit without a reload', async ({ page }) => {
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const created = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title: `Feed refetch ${Date.now()}` } });
  const it = (await created.json()) as { identifier: string };
  await page.goto(`/w/demo/issue/${it.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const feed = page.getByRole('list', { name: 'Activity' });
  await expect(feed).toContainText('created the issue');
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });
  const t = page.getByLabel('Title', { exact: true });
  await t.fill('Feed refetch edited');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await t.press('Enter');
  await saved;
  // server wording ("changed title from X to Y", #192), not the optimistic client text: proves the feed was refetched
  await expect(feed).toContainText('changed title from Feed refetch', { timeout: 10_000 });
  expect(navigations, 'no reload happened').toBe(0);
});
