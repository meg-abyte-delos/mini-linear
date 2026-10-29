import { test, expect } from '@playwright/test';
import { CYCLES } from '../../scripts/demo-ids';
import { API_MODE, DEMO } from './helpers/auth';

// Cycle burndown against the real stack: GET /cycles/:id/burndown on the seed's active cycle (c2, 2026-10-14..2026-10-27) and the SVG chart
// on the Cycles page. The seed writes issues without audit history, so this also covers the "no history" path. Skipped in mock mode.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

type Pt = { day: string; scope: number | null; done: number | null; remaining: number | null; ideal: number };
const url = (on: string) => `/api/v1/w/${DEMO.slug}/cycles/${CYCLES.c2}/burndown?on=${on}`;

test('burndown API: one point per day, ideal reaches 0, remaining = scope - done, null after `on`', async ({ page }) => {
  const res = await page.request.get(url('2026-10-27'));
  expect(res.status()).toBe(200);
  const { points } = (await res.json()) as { points: Pt[] };
  expect(points).toHaveLength(14);
  expect(points[0]!.day).toBe('2026-10-14');
  expect(points[13]!.day).toBe('2026-10-27');
  expect(points[0]!.scope).toBeGreaterThan(0);
  expect(points[0]!.ideal).toBe(points[0]!.scope);
  expect(points[13]!.ideal).toBe(0);
  for (const p of points) expect(p.remaining).toBe((p.scope as number) - (p.done as number));
  // Clock in the middle of the cycle: later days are null, the ideal line still spans the whole cycle.
  const mid = ((await (await page.request.get(url('2026-10-20'))).json()) as { points: Pt[] }).points;
  expect(mid[6]!.scope).not.toBeNull();
  expect(mid[7]).toMatchObject({ day: '2026-10-21', scope: null, done: null, remaining: null });
  expect(mid[13]!.ideal).toBe(0);
});

test('burndown API: bad `on` is 422, unknown cycle is 404', async ({ page }) => {
  expect((await page.request.get(url('yesterday'))).status()).toBe(422);
  expect((await page.request.get(`/api/v1/w/${DEMO.slug}/cycles/00000000-0000-4000-8000-0000000000ff/burndown`)).status()).toBe(404);
});

test('cycles page: Burndown toggles an SVG chart with remaining and ideal lines', async ({ page }) => {
  await page.goto('/?view=cycles&today=2026-10-27');
  await page.waitForSelector('html[data-ready]');
  const row = page.locator(`.cycle[data-cycle="${CYCLES.c2}"]`);
  const btn = row.getByRole('button', { name: 'Burndown' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const chart = page.locator(`[data-cycle-burndown="${CYCLES.c2}"]`).getByTestId('burndown-chart');
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAttribute('aria-label', /^Burndown for Cycle 2: \d+ of \d+ issues remaining on 2026-10-27$/);
  await expect(chart.locator('path.bd-line')).toHaveAttribute('d', /^M/);
  await expect(chart.locator('path.bd-ideal')).toHaveAttribute('stroke-dasharray', '5 4');
  await btn.click();
  await expect(chart).toHaveCount(0);
});
