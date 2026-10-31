import { test, expect, type Page } from '@playwright/test';
import { settled } from './helpers/settled';

// Sidebar saved views (PR #337, Thomas report): long names stay on ONE 28px line with an ellipsis, rows never overlap,
// the Shared tag never covers the name, and hover actions do not change the row height. Geometry asserts, plus a 1280 pixel baseline of the group.
// Views are created through the API and deleted after; names are fixed so the baseline is deterministic on a fresh DB.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });

const LONG = 'Everything assigned to the platform team, urgent or high, waiting for review';
const NAMES = ['Short', LONG, `${LONG.slice(0, 66)} (shared)`, 'Toutes les tâches', 'Priorités urgentes'];
const ids: { id: string; version: number }[] = [];

test.beforeEach(async ({ page }) => {
  ids.length = 0;
  await page.goto('/');
  for (const [i, name] of NAMES.entries()) {
    const r = await page.request.post('/api/v1/w/demo/views', { data: { name, shared: i === 2 } });
    expect(r.status()).toBe(201);
    const row = await r.json();
    ids.push({ id: row.id, version: row.version });
  }
});
// Per test (not per file) so a repeat run or a failure never leaks views into the other visual specs.
test.afterEach(async ({ page }) => {
  for (const v of ids) expect((await page.request.delete(`/api/v1/w/demo/views/${v.id}`, { headers: { 'If-Match': String(v.version) } })).status()).toBeLessThan(300);
});

async function open(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByTestId('saved-views').getByRole('link').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.mouse.move(0, 0);
}
const rects = (page: Page) => page.getByTestId('saved-views').locator('.sv-row').evaluateAll((rows) => rows.map((r) => {
  const b = r.getBoundingClientRect(), a = r.querySelector('a')!.getBoundingClientRect(), n = r.querySelector('.sv-name') as HTMLElement, t = r.querySelector('.sv-tag')?.getBoundingClientRect();
  return { top: b.top, bottom: b.bottom, h: b.height, linkH: a.height, nameRight: n.getBoundingClientRect().right, tagLeft: t?.left ?? null, clipped: n.scrollWidth > n.clientWidth, text: n.textContent };
}));

test('rows: every saved view is one 28px line, rows do not overlap, long names are ellipsized', async ({ page }) => {
  await open(page);
  const rs = (await rects(page)).filter((r) => NAMES.includes(r.text ?? ''));
  expect(rs).toHaveLength(NAMES.length);
  for (const r of rs) { expect(r.h).toBe(28); expect(r.linkH).toBe(28); }
  for (let i = 1; i < rs.length; i++) expect(rs[i]!.top, `row ${i} starts below row ${i - 1}`).toBeGreaterThanOrEqual(rs[i - 1]!.bottom);
  expect(rs.filter((r) => r.clipped).map((r) => r.text)).toEqual([LONG, `${LONG.slice(0, 66)} (shared)`]);
  for (const r of rs.filter((x) => x.tagLeft !== null)) expect(r.nameRight, 'name ends before the Shared tag').toBeLessThanOrEqual(r.tagLeft!);
});

test('hover: row actions appear without changing heights or neighbours', async ({ page }) => {
  await open(page);
  const before = await rects(page);
  const row = page.getByTestId('saved-views').locator('.sv-row').filter({ hasText: LONG }).first();
  await row.hover();
  await expect(row.getByRole('button', { name: /^Copy link to/ })).toBeVisible();
  await expect.poll(async () => Number(await row.locator('.sv-acts').evaluate((e) => getComputedStyle(e).opacity))).toBe(1);
  expect(await rects(page)).toEqual(before.map((r) => ({ ...r })));
  const a = await row.locator('.sv-acts').boundingBox(), r = await row.boundingBox();
  expect(a!.y).toBeGreaterThanOrEqual(r!.y); expect(a!.y + a!.height).toBeLessThanOrEqual(r!.y + r!.height);
});

test('visual: saved views group 1280 dark', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('saved-views')).toHaveScreenshot('sidebar-saved-views-1280.png', { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
});
