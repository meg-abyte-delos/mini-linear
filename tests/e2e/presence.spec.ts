import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { hashPassword } from '../../src/lib/auth/password';
import { DEMO, apiCreateIssue } from './helpers/auth';

// API-mode e2e (real Postgres, ML_API=1, no dev auth). Two real users in two browser contexts: B heartbeats on an issue,
// A (open on the app, subscribed to the SSE feed) sees B in a `presence` event; B leaves -> A sees an empty list.
const owner = process.env.DATABASE_OWNER_URL, pass = process.env.SEED_DEMO_PASSWORD;
test.skip(process.env.ML_API !== '1' || process.env.ML_DEV_AUTH === '1' || !owner || !pass || !DEMO.teamId, 'API-mode e2e (ML_API=1, DATABASE_OWNER_URL, SEED_DEMO_PASSWORD)');
test.describe.configure({ mode: 'serial' });

const B_EMAIL = 'presence-b@example.test';
let bId = '';

test.beforeAll(async () => {
  const pool = new pg.Pool({ connectionString: owner, max: 1 });
  try {
    const hash = await hashPassword(pass!);
    await pool.query(`insert into users (id, email, password_hash, email_verified_at) values (gen_random_uuid(), $1, $2, now())
      on conflict (lower(email)) do update set password_hash = excluded.password_hash`, [B_EMAIL, hash]);
    bId = (await pool.query('select id from users where lower(email) = $1', [B_EMAIL])).rows[0].id;
    const c = await pool.connect();
    try {
      await c.query('begin');
      const w = '00000000-0000-4000-8000-000000000001'; // fixed workspace id from scripts/seed-demo.mts (workspaces is under RLS: no lookup by slug before app.workspace_id is set)
      await c.query("select set_config('app.workspace_id', $1, true)", [w]);
      await c.query("insert into memberships (id, workspace_id, user_id, role) values (gen_random_uuid(), $1, $2, 'member') on conflict (workspace_id, user_id) do nothing", [w, bId]);
      await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3) on conflict do nothing', [w, DEMO.teamId, bId]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  } finally { await pool.end(); }
});

// Collects the `presence` SSE events of the page's own feed into window.__presence.
async function listen(page: Page) {
  await page.evaluate((slug) => {
    const w = window as unknown as { __presence: { issue_id: string; viewers: string[]; count: number }[]; __open: boolean };
    w.__presence = []; w.__open = false;
    const es = new EventSource(`/api/v1/w/${slug}/events`, { withCredentials: true });
    es.onopen = () => { w.__open = true; };
    es.addEventListener('presence', (m) => w.__presence.push(JSON.parse((m as MessageEvent).data)));
  }, DEMO.slug);
  await page.waitForFunction(() => (window as unknown as { __open: boolean }).__open);
}
const last = (page: Page, issueId: string) => page.evaluate((id) => (window as unknown as { __presence: { issue_id: string; viewers: string[]; count: number }[] }).__presence.filter((p) => p.issue_id === id).at(-1) ?? null, issueId);

test('B views an issue: A gets a presence event with B; B leaves: A gets an empty list', async ({ page, browser }) => {
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  const issue = await apiCreateIssue(page, `presence-${Date.now()}`);
  await listen(page);

  const ctxB = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const pb = await ctxB.newPage();
  const login = await pb.request.post('/api/v1/auth/login', { data: { email: B_EMAIL, password: pass } });
  expect(login.ok()).toBeTruthy();
  const url = `/api/v1/w/${DEMO.slug}/presence`;
  const hb = await pb.request.post(url, { data: { issue_id: issue.id } });
  expect(hb.status()).toBe(200);
  expect((await hb.json()).viewers.map((v: { user_id: string }) => v.user_id)).toEqual([bId]);

  await expect.poll(() => last(page, issue.id), { timeout: 15_000 }).toMatchObject({ viewers: [bId], count: 1 });

  // A heartbeats too: the list now holds both, newest first.
  const a = await page.request.post(url, { data: { issue_id: issue.id } });
  expect(a.status()).toBe(200);
  await expect.poll(async () => (await last(page, issue.id))?.count, { timeout: 15_000 }).toBe(2);

  // Heartbeat on an unknown issue / bad body is refused.
  expect((await pb.request.post(url, { data: { issue_id: '00000000-0000-4000-8000-0000000000ff' } })).status()).toBe(404);
  expect((await pb.request.post(url, { data: {} })).status()).toBe(422);

  const left = await pb.request.delete(url, { data: { issue_id: issue.id } });
  expect(left.status()).toBe(200);
  await expect.poll(() => last(page, issue.id), { timeout: 15_000 }).toMatchObject({ count: 1 });
  expect((await last(page, issue.id))!.viewers).not.toContain(bId);
  await page.request.delete(url, { data: { issue_id: issue.id } });
  await expect.poll(() => last(page, issue.id), { timeout: 15_000 }).toMatchObject({ viewers: [], count: 0 });
  await ctxB.close();
});

test('anonymous heartbeat is 401', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const r = await anon.post(`/api/v1/w/${DEMO.slug}/presence`, { data: { issue_id: '00000000-0000-4000-8000-0000000000ff' } });
  expect(r.status()).toBe(401);
  await anon.dispose();
});
