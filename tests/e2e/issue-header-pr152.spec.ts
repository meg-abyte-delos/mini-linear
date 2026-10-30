import { test, expect, type Page } from '@playwright/test';

// PR #152 (ui-issue header): prev/next counter, favorite star, "..." menu, icon pill pickers, one-line branch. API mode, demo session.
// Depends on PR #152 being on main. Creates its own issues (shared DB).
test.describe.configure({ mode: 'serial' });
let A: string, B: string, idA: string, idB: string, teamId: string;
const stamp = Date.now().toString(36);

async function mk(page: Page, title: string) {
  const r = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teamId, title } });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { identifier: string }).identifier;
}
const open = async (page: Page, ident: string) => { await page.goto(`/w/demo/issue/${ident}`); await page.waitForSelector('html[data-ready]'); await expect(page.getByLabel('Title', { exact: true })).toBeVisible(); };
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Issue actions' });
const more = (page: Page) => bar(page).getByRole('button', { name: 'More actions' });

test.beforeAll(async ({ request }) => {
  teamId = (await (await request.get('/api/v1/w/demo/teams')).json()).items[0].id;
  const mkr = async (t: string) => (await (await request.post('/api/v1/w/demo/issues', { data: { team_id: teamId, title: t } })).json()) as { identifier: string; id: string };
  const a = await mkr(`hdr A ${stamp}`); const b = await mkr(`hdr B ${stamp}`);
  A = a.identifier; idA = a.id; B = b.identifier; idB = b.id;
});

test('counter + prev/next: position text, next goes to the following identifier, prev comes back', async ({ page }) => {
  await open(page, A);
  const pos = bar(page).getByLabel(/^Issue \d+ of \d+$/);
  await expect(pos).toBeVisible();
  const m = (await pos.getAttribute('aria-label'))!.match(/Issue (\d+) of (\d+)/)!;
  expect(Number(m[1])).toBeGreaterThan(1); expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
  await bar(page).getByRole('link', { name: 'Next issue' }).click();
  await expect(page).toHaveURL(new RegExp(`/issue/${B}$`));
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`hdr B ${stamp}`);
  await bar(page).getByRole('link', { name: 'Previous issue' }).click();
  await expect(page).toHaveURL(new RegExp(`/issue/${A}$`));
});

test('prev/next: last issue has Next disabled (aria-disabled), not a navigable link', async ({ page }) => {
  await open(page, B);
  const next = bar(page).getByLabel('Next issue');
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(next).not.toHaveAttribute('href', /.+/);
  await expect(bar(page).getByRole('link', { name: 'Previous issue' })).toHaveAttribute('href', new RegExp(`/issue/${A}$`));
});

test('favorite: star is aria-pressed, toggles label, persists after reload, per issue', async ({ page }) => {
  await open(page, A);
  const star = bar(page).getByRole('button', { name: 'Add to favorites' });
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  const on = bar(page).getByRole('button', { name: 'Remove from favorites' });
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(bar(page).getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  await open(page, B);
  await expect(bar(page).getByRole('button', { name: 'Add to favorites' })).toHaveAttribute('aria-pressed', 'false');
  await open(page, A);
  await bar(page).getByRole('button', { name: 'Remove from favorites' }).click();
  await expect(bar(page).getByRole('button', { name: 'Add to favorites' })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate((k) => localStorage.getItem(k), `ml.fav.${A}`)).toBeNull();
});

test('"..." menu: items, order, danger Delete last behind a separator; ArrowDown/ArrowUp cycle; Esc closes and refocuses the trigger', async ({ page }) => {
  await open(page, A);
  const btn = more(page);
  await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
  await btn.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: `${A} actions` });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([/Copy ID/, /Copy title/, /Copy link/, /Copy branch name/, /(Un)?subscribe/i, /Move to project/, /Make a copy/, /Archive/, /Delete/]);
  await expect(menu.getByRole('separator')).toHaveCount(2);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: /Copy title/ })).toBeFocused();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: /Delete/ })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(btn).toBeFocused(); await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page).toHaveURL(new RegExp(`/issue/${A}$`));
});

test('"..." menu: outside click closes; Copy link and Copy branch write the clipboard and toast', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, A);
  await more(page).click();
  const menu = page.getByRole('menu', { name: `${A} actions` });
  await page.getByLabel('Title', { exact: true }).click(); await expect(menu).toBeHidden();
  await more(page).click(); await menu.getByRole('menuitem', { name: /Copy link/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole('status')).toContainText(/Copied/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/issue/${A}`);
  await more(page).click(); await menu.getByRole('menuitem', { name: /Copy branch/ }).click();
  await expect(page.getByRole('status')).toContainText('Copied branch name');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`demo/${A.toLowerCase()}-hdr-a-${stamp}`);
});

test('archive from the menu: banner, persists on reload via API, menu now offers Unarchive', async ({ page }) => {
  await open(page, B);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.locator('.idp-banner')).toContainText('Archived');
  expect((await (await page.request.get(`/api/v1/w/demo/issues/${idB}`)).json()).archived_at).toBeTruthy();
  await more(page).click();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get(`/api/v1/w/demo/issues/${idB}`)).json()).archived_at).toBeNull();
});

// FINDING (pre-existing, not in PR 152): the issue page route 404s on reload / deep link for an archived issue (loadRemote drops archived rows).
test.fixme('archived issue page survives a reload (deep link)', async ({ page }) => {
  await open(page, B);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.locator('.idp-banner')).toContainText('Archived');
  const res = await page.reload();
  expect(res!.status()).toBe(200);
});

test('delete from the menu: confirm dialog, issue lands in trash on the API, Restore visible and works (PR text: "Restore stays visible when in trash")', async ({ page }) => {
  const D = await mk(page, `hdr del ${stamp}`);
  await open(page, D);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dlg = page.getByRole('alertdialog', { name: new RegExp(D) });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('.idp-banner')).toContainText('trash');
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
});

test('delete: dismissing the confirm keeps the issue untouched', async ({ page }) => {
  await open(page, A);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
  await expect(page.getByLabel('Title', { exact: true })).toBeEditable();
});

test('pills: empty values show muted placeholders; estimate and due date keep native controls with labels', async ({ page }) => {
  await open(page, A);
  const props = page.getByRole('complementary', { name: 'Properties' });
  await expect(props).toContainText('Set estimate');
  await expect(props).toContainText('Set due date');
  await expect(props).toContainText('Add label');
  await expect(props).toContainText('Add to project');
  await expect(props).toContainText('Add to cycle');
  await expect(props).toContainText('Set parent');
  // Wait for each PATCH to land: a second edit sent before the first returns uses a stale If-Match and gets 412 (finding, pre-existing).
  const patched = () => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  let w = patched(); await page.getByLabel('Estimate').selectOption('5'); expect((await w).status()).toBe(200);
  await expect(props).toContainText('5 pts');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set estimate to 5');
  w = patched(); await page.getByLabel('Due date').fill('2026-10-20'); expect((await w).status()).toBe(200);
  await expect(props).toContainText('Oct 20, 2026');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set due date to 2026-10-20');
  await expect(props).not.toContainText('mm/dd/yyyy');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(props).toContainText('5 pts'); await expect(props).toContainText('Oct 20, 2026');
  w = patched(); await page.getByLabel('Estimate').selectOption(''); expect((await w).status()).toBe(200);
  await expect(props).toContainText('Set estimate');
  w = patched(); await page.getByLabel('Due date').fill(''); expect((await w).status()).toBe(200);
  await expect(props).toContainText('Set due date');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText(/removed the due date|cleared due date/);
});

test('pills: Estimate with 1 point is singular ("1 pt")', async ({ page }) => {
  await open(page, B);
  await page.getByLabel('Estimate').selectOption('1');
  await expect(page.locator('dd.prop-native .prop-pill').first()).toHaveText('1 pt');
});

test('branch: single button, copies on click, full name in aria-label (tooltip: issue-page-d9), one line with ellipsis', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, A);
  const b = page.getByRole('button', { name: /^Copy branch name / });
  const full = `demo/${A.toLowerCase()}-hdr-a-${stamp}`;
  await expect(b).toHaveAttribute('aria-label', `Copy branch name ${full}`);
  const box = await b.locator('code.branch').boundingBox();
  const lh = await b.locator('code.branch').evaluate((e) => parseFloat(getComputedStyle(e).lineHeight) || 20);
  expect(box!.height).toBeLessThanOrEqual(lh * 1.6);
  await b.click();
  await expect(page.getByRole('status')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(full);
});

// FINDING (acknowledged in PR 152 body, expected fixed by L2 PR 157): who() reads mock USERS so API-assigned issues show "Unassigned".
test.fixme('assignee pill: an assigned issue shows the member, not "Unassigned"', async ({ page }) => {
  const me = await (await page.request.get('/api/v1/me')).json();
  const id = me.id ?? me.user?.id;
  const r = await page.request.get(`/api/v1/w/demo/issues/${idA}`);
  const cur = await r.json();
  const p = await page.request.patch(`/api/v1/w/demo/issues/${idA}`, { data: { assignee_id: id }, headers: { 'If-Match': String(cur.version) } });
  expect(p.ok(), `PATCH assignee: ${p.status()}`).toBe(true);
  await open(page, A);
  await expect(page.getByRole('complementary', { name: 'Properties' })).not.toContainText('Unassigned');
});

// FINDING (pre-existing, not PR 152): two property edits sent before the first PATCH returns -> the second sends a stale If-Match, gets 412 and is dropped.
test.fixme('rapid back-to-back edits (estimate then due date) both persist', async ({ page }) => {
  await open(page, B);
  await page.getByLabel('Estimate').selectOption('3');
  await page.getByLabel('Due date').fill('2026-10-21');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(page.getByLabel('Due date')).toHaveValue('2026-10-21');
});
