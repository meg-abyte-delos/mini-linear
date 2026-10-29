import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { USERS } from '../../scripts/demo-ids';
import { API_MODE, DEMO, apiCreateIssue } from './helpers/auth';
import { GUEST_STATE, STORAGE_STATE } from './global-setup';

// Presence (#136) over HTTP with two real sessions (two tabs = two users on the same issue). No presence UI is mounted yet (watchPresence is unused),
// so this drives the heartbeat API: POST = I am here, DELETE = I left, GET = who is here. TTL expiry (30 s) stays in the integration suite.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

type Viewers = { viewers: { user_id: string }[]; count: number };
const pu = (id: string) => `/api/v1/w/${DEMO.slug}/issues/${id}/presence`;
const ids = (j: Viewers) => j.viewers.map((v) => v.user_id);

let mate: APIRequestContext;
test.beforeAll(async ({ baseURL }) => {
  const origin = baseURL ?? 'http://localhost:3000';
  mate = await pwRequest.newContext({ baseURL: origin, extraHTTPHeaders: { origin } });
  const res = await mate.post('/api/v1/auth/login', { data: { email: USERS.mate.email, password: process.env.SEED_DEMO_PASSWORD ?? process.env.E2E_PASSWORD } });
  expect(res.ok(), 'mate login').toBeTruthy();
});
test.afterAll(async () => { await mate.dispose(); });

test('two users on one issue see each other; leaving removes only the leaver', async ({ page }) => {
  const issue = await apiCreateIssue(page, `presence-${Date.now()}`);
  const a = page.request;
  try {
    expect(ids(await (await a.post(pu(issue.id))).json())).toEqual([USERS.admin.id]);
    const seenByMate = (await (await mate.post(pu(issue.id))).json()) as Viewers;
    expect(new Set(ids(seenByMate))).toEqual(new Set([USERS.admin.id, USERS.mate.id]));
    expect(seenByMate.count).toBe(2);
    expect(new Set(ids(await (await a.get(pu(issue.id))).json()))).toEqual(new Set([USERS.admin.id, USERS.mate.id]));
    const afterLeave = (await (await a.delete(pu(issue.id))).json()) as Viewers;
    expect(ids(afterLeave)).toEqual([USERS.mate.id]);
    expect(ids(await (await mate.get(pu(issue.id))).json())).toEqual([USERS.mate.id]);
  } finally {
    await mate.delete(pu(issue.id)); await a.delete(pu(issue.id));
  }
});

test('heartbeats are idempotent: repeated POSTs keep one entry per user', async ({ page }) => {
  const issue = await apiCreateIssue(page, `presence-idem-${Date.now()}`);
  try {
    for (let i = 0; i < 3; i++) expect((await page.request.post(pu(issue.id))).status()).toBe(200);
    const j = (await (await page.request.get(pu(issue.id))).json()) as Viewers;
    expect(ids(j)).toEqual([USERS.admin.id]);
    expect(j.count).toBe(1);
  } finally { await page.request.delete(pu(issue.id)); }
});

test('leaving without having joined is harmless; a reload then re-joins with one POST', async ({ page }) => {
  const issue = await apiCreateIssue(page, `presence-leave-${Date.now()}`);
  try {
    const left = await page.request.delete(pu(issue.id));
    expect(left.status()).toBe(200);
    expect(((await left.json()) as Viewers).viewers).toEqual([]);
    await page.goto('/'); await page.waitForSelector('html[data-ready]');
    await page.reload(); await page.waitForSelector('html[data-ready]');
    expect(ids(await (await page.request.post(pu(issue.id))).json())).toEqual([USERS.admin.id]);
  } finally { await page.request.delete(pu(issue.id)); }
});

test('no session: 401 on every verb; unknown issue 404; malformed id 4xx never 5xx', async ({ page, playwright, baseURL }) => {
  const issue = await apiCreateIssue(page, `presence-authz-${Date.now()}`);
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    for (const m of ['get', 'post', 'delete'] as const) expect((await anon[m](pu(issue.id))).status(), `anon ${m}`).toBe(401);
    expect((await page.request.post(pu('00000000-0000-4000-8000-0000000000ff'))).status()).toBe(404);
    const bad = await page.request.get(pu('not-a-uuid'));
    expect(bad.status()).toBeGreaterThanOrEqual(400); expect(bad.status()).toBeLessThan(500);
  } finally { await anon.dispose(); await page.request.delete(pu(issue.id)); }
});

test('guest never receives another user id from the presence list', async ({ playwright, baseURL }) => {
  const admin = await playwright.request.newContext({ baseURL, storageState: STORAGE_STATE });
  const guest = await playwright.request.newContext({ baseURL, storageState: GUEST_STATE });
  const res = await admin.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: DEMO.teamId, title: `presence-guest-${Date.now()}` } });
  expect(res.status()).toBe(201);
  const issue = (await res.json()) as { id: string };
  try {
    await admin.post(pu(issue.id));
    const g = await guest.get(pu(issue.id));
    expect([200, 404], 'guest status').toContain(g.status());
    if (g.status() === 200) {
      const j = (await g.json()) as Viewers;
      expect(JSON.stringify(j)).not.toContain(USERS.admin.id);
      expect(j.count).toBeGreaterThanOrEqual(1);
    }
  } finally { await admin.delete(pu(issue.id)); await admin.dispose(); await guest.dispose(); }
});
