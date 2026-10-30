import { test, expect, type Page } from '@playwright/test';

// D9 issue page polish: no hydration error, avatars + status icons in the feed, Comment disabled when empty, branch tooltip + copy. API mode, demo session.
const stamp = Date.now().toString(36);
const etag = (v: number) => String.fromCharCode(34) + v + String.fromCharCode(34);
let ident: string;

test.beforeAll(async ({ request }) => {
  const teamId = (await (await request.get('/api/v1/w/demo/teams')).json()).items[0].id;
  const it = (await (await request.post('/api/v1/w/demo/issues', { data: { team_id: teamId, title: `D9 polish ${stamp}` } })).json()) as { id: string; identifier: string; version: number };
  ident = it.identifier;
  const r = await request.patch(`/api/v1/w/demo/issues/${it.id}`, { data: { status: 'in_progress' }, headers: { 'If-Match': etag(it.version) } });
  expect(r.status()).toBe(200);
});

const open = async (page: Page) => { await page.goto(`/w/demo/issue/${ident}`); await page.waitForSelector('html[data-ready]'); await expect(page.getByLabel('Title', { exact: true })).toBeVisible(); };

test('no React hydration error or page error on load', async ({ page }) => {
  const bad: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && /hydrat|did not match|Minified React error|aria-controls/i.test(m.text())) bad.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => bad.push(e.message));
  await open(page);
  await page.waitForTimeout(500);
  expect(bad).toEqual([]);
});

test('activity entries show an avatar and the status icon for status changes', async ({ page }) => {
  await open(page);
  const feed = page.getByRole('list', { name: 'Activity' });
  const ev = feed.locator('li.ev', { hasText: /status/i }).first();
  await expect(ev).toBeVisible();
  await expect(ev.locator('.av')).toHaveCount(1);
  await expect(ev.locator('svg.si-in_progress')).toHaveCount(1);
  await expect(feed.locator('li.ev', { hasText: 'created the issue' }).locator('.av')).toHaveCount(1);
});

test('Comment button is disabled while the box is empty or blank', async ({ page }) => {
  await open(page);
  const box = page.getByLabel('Leave a comment', { exact: true });
  const btn = page.getByRole('button', { name: 'Comment', exact: true });
  await expect(btn).toBeDisabled();
  await box.fill('   ');
  await expect(btn).toBeDisabled();
  await box.fill('hello');
  await expect(btn).toBeEnabled();
  await box.fill('');
  await expect(btn).toBeDisabled();
});

test('branch: full name in a tooltip on hover and focus, copy button copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  const full = `demo/${ident.toLowerCase()}-d9-polish-${stamp}`;
  const b = page.getByRole('button', { name: /^Copy branch name / });
  await b.hover();
  await expect(page.getByRole('tooltip')).toHaveText(full);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await b.focus();
  await expect(page.getByRole('tooltip')).toHaveText(full);
  await b.click();
  await expect(page.getByRole('status')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(full);
  await expect(b.locator('.branch-copy svg')).toBeVisible();
});
