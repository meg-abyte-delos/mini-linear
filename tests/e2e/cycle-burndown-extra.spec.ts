import { test, expect, type APIRequestContext } from '@playwright/test';
import { CYCLES } from '../../scripts/demo-ids';
import { API_MODE, DEMO } from './helpers/auth';

// Complement to cycle-burndown.spec.ts (#144): bounds, ordering, null tail, validation, authz, and that closing an issue moves `done` on the cycle's last day.
// Seed cycles (scripts/seed-demo.mts): c2 = 2026-10-14..2026-10-27, c3 = 2026-10-28..2026-11-10.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

type Pt = { day: string; scope: number | null; done: number | null; remaining: number | null; ideal: number };
const W = `/api/v1/w/${DEMO.slug}`;
const bd = async (r: APIRequestContext, id: string, on?: string) => {
  const res = await r.get(`${W}/cycles/${id}/burndown${on ? `?on=${on}` : ''}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as { cycle: { id: string }; points: Pt[] };
};

test('c3: 14 inclusive days 28 Oct to 10 Nov, ordered, unique, ideal non-increasing down to 0', async ({ page }) => {
  const { cycle, points } = await bd(page.request, CYCLES.c3, '2026-11-10');
  expect(cycle.id).toBe(CYCLES.c3);
  expect(points).toHaveLength(14);
  expect(points[0]!.day).toBe('2026-10-28');
  expect(points[13]!.day).toBe('2026-11-10');
  const days = points.map((p) => p.day);
  expect(new Set(days).size).toBe(14);
  expect([...days].sort()).toEqual(days);
  for (let i = 1; i < 14; i++) expect(points[i]!.ideal).toBeLessThanOrEqual(points[i - 1]!.ideal);
  expect(points[13]!.ideal).toBe(0);
});

test('past days: 0 <= done <= scope and remaining = scope - done', async ({ page }) => {
  const { points } = await bd(page.request, CYCLES.c2, '2026-10-27');
  for (const p of points) {
    expect(p.scope).not.toBeNull(); expect(p.done).not.toBeNull();
    expect(p.done!).toBeGreaterThanOrEqual(0);
    expect(p.done!).toBeLessThanOrEqual(p.scope!);
    expect(p.remaining).toBe(p.scope! - p.done!);
  }
});

test('`on` cuts the series: later days are null, earlier ones filled, ideal always defined', async ({ page }) => {
  const { points } = await bd(page.request, CYCLES.c2, '2026-10-17');
  expect(points).toHaveLength(14);
  for (const p of points) {
    expect(typeof p.ideal).toBe('number');
    if (p.day <= '2026-10-17') { expect(p.scope).not.toBeNull(); expect(p.done).not.toBeNull(); expect(p.remaining).not.toBeNull(); }
    else { expect(p.scope).toBeNull(); expect(p.done).toBeNull(); expect(p.remaining).toBeNull(); }
  }
  const early = (await bd(page.request, CYCLES.c3, '2026-01-01')).points;
  expect(early).toHaveLength(14);
  expect(early.every((p) => p.scope === null && p.done === null)).toBe(true);
});

test('invalid `on` is 422 (format and impossible dates)', async ({ page }) => {
  for (const bad of ['not-a-date', '2026-13-45', '2026-02-30', '27-10-2026', '2026-1-5']) {
    const r = await page.request.get(`${W}/cycles/${CYCLES.c2}/burndown?on=${bad}`);
    expect(r.status(), `on=${bad}`).toBe(422);
  }
});

test('unknown cycle 404; malformed id 4xx not 5xx; no session 401; foreign workspace slug 403/404', async ({ page, playwright, baseURL }) => {
  expect((await page.request.get(`${W}/cycles/00000000-0000-4000-8000-0000000000ff/burndown?on=2026-10-30`)).status()).toBe(404);
  const bad = await page.request.get(`${W}/cycles/not-a-uuid/burndown`);
  expect(bad.status()).toBeGreaterThanOrEqual(400); expect(bad.status()).toBeLessThan(500);
  const foreign = await page.request.get(`/api/v1/w/not-my-workspace/cycles/${CYCLES.c2}/burndown?on=2026-10-27`);
  expect([403, 404]).toContain(foreign.status());
  const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  expect((await anon.get(`${W}/cycles/${CYCLES.c2}/burndown?on=2026-10-27`)).status()).toBe(401);
  await anon.dispose();
});

test('closing an issue of c3 raises done (and scope) on the last day; cleanup restores them', async ({ page }) => {
  // Audit timestamps are real time: only meaningful while the real clock is inside c3.
  const today = new Date().toISOString().slice(0, 10);
  test.skip(today < '2026-10-28' || today > '2026-11-10', 'real clock is outside cycle c3');
  const before = (await bd(page.request, CYCLES.c3, '2026-11-10')).points[13]!;
  const created = await page.request.post(`${W}/issues`, { data: { team_id: DEMO.teamId, title: `burndown-${Date.now()}`, cycle_id: CYCLES.c3 } });
  expect(created.status()).toBe(201);
  const issue = (await created.json()) as { id: string };
  try {
    const mid = (await bd(page.request, CYCLES.c3, '2026-11-10')).points[13]!;
    expect(mid.scope).toBe(before.scope! + 1);
    expect(mid.done).toBe(before.done!);
    const closed = await page.request.post(`${W}/issues/bulk`, { data: { ids: [issue.id], patch: { status: 'done' } } });
    expect(closed.status()).toBe(200);
    await page.goto('/'); await page.waitForSelector('html[data-ready]');
    await page.reload(); await page.waitForSelector('html[data-ready]');
    const after = (await bd(page.request, CYCLES.c3, '2026-11-10')).points[13]!;
    expect(after.done).toBe(before.done! + 1);
    expect(after.scope).toBe(before.scope! + 1);
    expect(after.remaining).toBe(before.remaining);
  } finally {
    const cur = await page.request.get(`${W}/issues/${issue.id}`);
    if (cur.ok()) { const v = ((await cur.json()) as { version: number }).version; await page.request.delete(`${W}/issues/${issue.id}`, { headers: { 'if-match': `"${v}"` } }); }
  }
  const restored = (await bd(page.request, CYCLES.c3, '2026-11-10')).points[13]!;
  expect(restored.scope).toBe(before.scope);
  expect(restored.done).toBe(before.done);
});

test('cycles page: chart label for c2 matches the API at the test clock', async ({ page }) => {
  await page.goto('/?view=cycles&today=2026-10-27');
  await page.waitForSelector('html[data-ready]');
  await page.locator(`.cycle[data-cycle="${CYCLES.c2}"]`).getByRole('button', { name: 'Burndown' }).click();
  const chart = page.locator(`[data-cycle-burndown="${CYCLES.c2}"]`).getByTestId('burndown-chart');
  await expect(chart).toBeVisible();
  const last = (await bd(page.request, CYCLES.c2, '2026-10-27')).points[13]!;
  await expect(chart).toHaveAttribute('aria-label', `Burndown for Cycle 2: ${last.remaining} of ${last.scope} issues remaining on 2026-10-27`);
});
