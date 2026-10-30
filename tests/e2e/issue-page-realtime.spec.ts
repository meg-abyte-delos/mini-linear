import { test, expect } from '@playwright/test';

// Two tabs on the same issue page (same session): writes made in tab B show up live in tab A (title, comment, deletion
// notice) without a reload, and a failed save rolls the optimistic edit back.
test('issue page: edits, comments and deletion from another tab arrive live; failed save rolls back', async ({ page: a, context }) => {
  const b = await context.newPage();
  const teams = await (await a.request.get('/api/v1/w/demo/teams')).json();
  const created = await a.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title: `rt-page-${Date.now()}` } });
  expect(created.status()).toBe(201);
  const it = (await created.json()) as { id: string; identifier: string; title: string };
  await a.goto(`/w/demo/issue/${it.identifier}`); await a.waitForSelector('html[data-ready]');
  await b.goto(`/w/demo/issue/${it.identifier}`); await b.waitForSelector('html[data-ready]');

  // 1. title edited in B shows in A
  const bt = b.getByLabel('Title', { exact: true });
  await bt.fill(`${it.title}-b`);
  await bt.press('Enter');
  await expect(a.getByLabel('Title', { exact: true })).toHaveValue(`${it.title}-b`, { timeout: 10_000 });

  // 2. comment posted through the API shows in A
  const text = `live comment ${Date.now()}`;
  const c = await b.request.post(`/api/v1/w/demo/issues/${it.id}/comments`, { data: { body: text } });
  expect(c.ok()).toBe(true);
  await expect(a.getByText(text)).toBeVisible({ timeout: 10_000 });

  // 3. a failed save rolls back to the confirmed title
  const url = `**/api/v1/w/demo/issues/${it.id}`;
  await a.route(url, (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()));
  try {
    const at = a.getByLabel('Title', { exact: true });
    await at.fill('will not stick'); await at.press('Enter');
    await expect(at).toHaveValue(`${it.title}-b`, { timeout: 10_000 });
  } finally {
    await a.unroute(url);
  }

  // 4. deleted elsewhere: notice in A
  const cur = (await (await b.request.get(`/api/v1/w/demo/issues/${it.id}`)).json()) as { version: number };
  const del = await b.request.delete(`/api/v1/w/demo/issues/${it.id}`, { headers: { 'if-match': `"${cur.version}"` } });
  expect([200, 204]).toContain(del.status());
  await expect(a.getByRole('alert').filter({ hasText: 'deleted' })).toBeVisible({ timeout: 10_000 });
});
