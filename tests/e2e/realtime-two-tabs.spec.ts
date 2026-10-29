import { test, expect } from '@playwright/test';

// Needs the API-mode server: ML_API=1 ML_DEV_AUTH=1 + Postgres (see docs/sync.md). Skipped in the default mock-mode e2e run.
const slug = process.env.ML_WORKSPACE_SLUG, team = process.env.ML_TEAM_ID;
test.skip(process.env.ML_API !== '1' || !slug || !team, 'API-mode e2e (ML_API=1)');

test('two tabs: a create, rename and delete in tab B show up live in tab A', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage(), b = await ctx.newPage();
  await a.goto('/'); await a.waitForSelector('html[data-ready]');
  await b.goto('/'); await b.waitForSelector('html[data-ready]');
  const title = `rt-${Date.now()}`;
  // Tab B writes through the API (same session, same workspace).
  const created = await b.evaluate(async ([s, t, n]) => {
    const r = await fetch(`/api/v1/w/${s}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team_id: t, title: n }) });
    return (await r.json()) as { id: string; version: number };
  }, [slug, team, title] as const);
  await expect(a.getByText(title)).toBeVisible({ timeout: 10_000 });
  await b.evaluate(async ([s, id, v, n]) => {
    await fetch(`/api/v1/w/${s}/issues/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${v}"` }, body: JSON.stringify({ title: n }) });
  }, [slug, created.id, created.version, `${title}-renamed`] as const);
  await expect(a.getByText(`${title}-renamed`)).toBeVisible({ timeout: 10_000 });
  await expect(a.getByText(title, { exact: true })).toHaveCount(0);
  const del = await b.evaluate(async ([s, id]) => {
    const cur = (await (await fetch(`/api/v1/w/${s}/issues/${id}`)).json()) as { version: number };
    return (await fetch(`/api/v1/w/${s}/issues/${id}`, { method: 'DELETE', headers: { 'if-match': `"${cur.version}"` } })).status;
  }, [slug, created.id] as const);
  expect([200, 204]).toContain(del);
  await expect(a.getByText(`${title}-renamed`)).toHaveCount(0, { timeout: 10_000 });
  await ctx.close();
});
