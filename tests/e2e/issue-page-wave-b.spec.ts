import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Wave B: issue page. WYSIWYG description (no Write/Preview), ID + status in the header, grouped properties,
// full "..." menu, delete confirm dialog. API mode, demo session. Creates its own issues (shared DB).
const stamp = Date.now().toString(36);
let teamId: string;
const created: string[] = []; // every issue this file makes (copies too): deleted in afterAll so the shared DB stays clean

async function mk(page: Page, title: string, extra: Record<string, unknown> = {}) {
  const r = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teamId, title, ...extra } });
  expect(r.status()).toBe(201);
  const j = (await r.json()) as { identifier: string; id: string };
  created.push(j.id);
  return j;
}
const open = async (page: Page, ident: string) => { await page.goto(`/w/demo/issue/${ident}`); await page.waitForSelector('html[data-ready]'); await expect(page.getByLabel('Title', { exact: true })).toBeVisible(); };
const more = (page: Page) => page.getByRole('toolbar', { name: 'Issue actions' }).getByRole('button', { name: 'More actions' });
const editor = (page: Page) => page.getByRole('textbox', { name: 'Description' });
const desc = async (page: Page, id: string) => ((await (await page.request.get(`/api/v1/w/demo/issues/${id}`)).json()) as { description: string }).description;
const blurSave = async (page: Page) => {
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.getByLabel('Title', { exact: true }).click();
  expect((await saved).status()).toBe(200);
};

test.afterAll(async ({ request }) => {
  // DELETE needs If-Match (a bare DELETE gets a silent 428): read the version, then assert the delete really happened.
  for (const id of created) {
    const g = await request.get('/api/v1/w/demo/issues/' + id);
    if (g.status() === 404) continue;
    const v = (await g.json()).version;
    const r = await request.delete('/api/v1/w/demo/issues/' + id, { headers: { 'If-Match': '"' + v + '"' } });
    expect(r.status()).toBeLessThan(300);
  }
});

test.beforeAll(async ({ request }) => { teamId = (await (await request.get('/api/v1/w/demo/teams')).json()).items[0].id; });

test('header shows the ID and the status; the status button opens the picker', async ({ page }) => {
  const a = await mk(page, `wb header ${stamp}`);
  await open(page, a.identifier);
  const head = page.locator('.idp-head');
  await expect(head.getByLabel('Breadcrumb')).toContainText(a.identifier);
  const st = head.getByRole('button', { name: /^Status: .*Change status$/ });
  await expect(st).toBeVisible();
  await st.click();
  await page.getByRole('dialog', { name: 'Change status' }).getByRole('option', { name: /Done/ }).click();
  await expect(st).toContainText('Done');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toContainText('Done');
});

test('properties are grouped under four headings', async ({ page }) => {
  const a = await mk(page, `wb groups ${stamp}`);
  await open(page, a.identifier);
  const side = page.getByRole('complementary', { name: 'Properties' });
  await expect(side.getByRole('heading')).toHaveText(['Properties', 'Planning', 'Organization', 'Git']);
  const g = (name: string) => side.getByRole('region', { name });
  await expect(g('Properties')).toContainText('Priority');
  await expect(g('Planning')).toContainText('Estimate');
  await expect(g('Planning')).toContainText('Cycle');
  await expect(g('Organization')).toContainText('Project');
  await expect(g('Git')).toContainText('Branch');
});

test('description: no tabs, markdown shortcuts build blocks, blur saves markdown to the API', async ({ page }) => {
  const a = await mk(page, `wb editor ${stamp}`);
  await open(page, a.identifier);
  await expect(page.getByRole('tab')).toHaveCount(0);
  const ed = editor(page);
  await expect(ed).toHaveAttribute('data-empty', 'true');
  await ed.click();
  await page.keyboard.type('# Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Intro with ');
  await page.keyboard.press('Control+b'); await page.keyboard.type('bold'); await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- first'); await page.keyboard.press('Enter'); await page.keyboard.type('second');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); // empty item leaves the list
  await page.keyboard.type('[] ship it'); await page.keyboard.press('Enter'); await page.keyboard.type('and test');
  await expect(ed.locator('h1')).toHaveText('Plan');
  await expect(ed.locator('ul').first().locator('li')).toHaveCount(2);
  await expect(ed.locator('ul[data-tasks] li')).toHaveCount(2);
  await blurSave(page);
  expect(await desc(page, a.id)).toBe('# Plan\n\nIntro with **bold**\n\n- first\n- second\n\n- [ ] ship it\n- [ ] and test');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(ed.locator('h1')).toHaveText('Plan');
  await expect(ed.locator('strong')).toHaveText('bold');
});

test('description: clicking the checkbox gutter toggles a task and saves it', async ({ page }) => {
  const a = await mk(page, `wb tasks ${stamp}`, { description: '- [ ] one\n- [x] two' });
  await open(page, a.identifier);
  const li = editor(page).locator('ul[data-tasks] li').first();
  await expect(li).toHaveAttribute('data-done', '0');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await li.click({ position: { x: 6, y: 10 } });
  expect((await saved).status()).toBe(200);
  await expect(li).toHaveAttribute('data-done', '1');
  expect(await desc(page, a.id)).toBe('- [x] one\n- [x] two');
});

test('description: focus + blur without an edit sends no PATCH and keeps the stored markdown', async ({ page }) => {
  const raw = 'a\nb\n\n#### h\n\n* x\n  * nested';
  const a = await mk(page, `wb nodirty ${stamp}`, { description: raw });
  await open(page, a.identifier);
  const patches: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/issues/')) patches.push(r.url()); });
  await editor(page).click();
  await expect(editor(page)).toBeFocused();
  await page.getByLabel('Title', { exact: true }).click();
  await page.waitForTimeout(600);
  expect(patches).toEqual([]);
  expect(await desc(page, a.id)).toBe(raw);
  await expect(page.getByText('updated the description')).toHaveCount(0);
});

test('description: a real edit still saves on blur', async ({ page }) => {
  const a = await mk(page, `wb dirty ${stamp}`, { description: 'a\nb' });
  await open(page, a.identifier);
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' more');
  await blurSave(page);
  expect(await desc(page, a.id)).toContain('more');
});

test('toolbar: arrow keys move between the buttons, Home and End jump', async ({ page }) => {
  const a = await mk(page, `wb bar ${stamp}`);
  await open(page, a.identifier);
  const bar = page.getByRole('toolbar', { name: 'Description formatting' });
  await bar.getByRole('button', { name: 'Bold' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar.getByRole('button', { name: 'Italic' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(bar.getByRole('button', { name: 'Code block' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(bar.getByRole('button', { name: 'Bold' })).toBeFocused();
});

test('description: toolbar applies formatting, link form accepts http(s) only, Esc closes it', async ({ page }) => {
  const a = await mk(page, `wb toolbar ${stamp}`, { description: 'hello world' });
  await open(page, a.identifier);
  const ed = editor(page);
  await ed.click(); await page.keyboard.press('Control+a');
  const bar = page.getByRole('toolbar', { name: 'Description formatting' });
  await bar.getByRole('button', { name: 'Italic' }).click();
  await expect(ed.locator('em, i')).toHaveText('hello world');
  await bar.getByRole('button', { name: 'Link' }).click();
  await page.getByLabel('Link URL').fill('javascript:alert(1)'); await page.keyboard.press('Enter');
  await expect(ed.locator('a')).toHaveCount(0);
  await ed.click(); await page.keyboard.press('Control+a');
  await bar.getByRole('button', { name: 'Link' }).click();
  await page.getByLabel('Link URL').fill('https://linear.app'); await page.keyboard.press('Enter');
  await expect(ed.locator('a')).toHaveAttribute('href', 'https://linear.app');
  await bar.getByRole('button', { name: 'Link' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Link URL')).toHaveCount(0);
  await blurSave(page);
  expect(await desc(page, a.id)).toBe('_[hello world](https://linear.app)_');
});

test('description is read-only for a trashed issue', async ({ page }) => {
  const a = await mk(page, `wb ro ${stamp}`, { description: 'frozen' });
  await open(page, a.identifier);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.idp-banner')).toContainText('trash');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('toolbar', { name: 'Description formatting' })).toHaveCount(0);
});

test('menu: Copy ID, Copy title and Copy link write the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const a = await mk(page, `wb copy ${stamp}`);
  await open(page, a.identifier);
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  await more(page).click(); await page.getByRole('menuitem', { name: 'Copy ID' }).click();
  await expect(page.getByRole('status')).toContainText('Copied issue ID');
  expect(await clip()).toBe(a.identifier);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Copy title' }).click();
  expect(await clip()).toBe(`wb copy ${stamp}`);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Copy link' }).click();
  expect(await clip()).toContain(`/issue/${a.identifier}`);
});

test('menu: Subscribe toggles and persists on the API', async ({ page }) => {
  const a = await mk(page, `wb sub ${stamp}`);
  await open(page, a.identifier);
  const state = async () => (await (await page.request.get(`/api/v1/w/demo/issues/${a.id}/subscription`)).json()).subscribed as boolean;
  await more(page).click();
  const item = page.getByRole('menuitem', { name: /^(Subscribe|Unsubscribe)/ });
  const before = (await item.textContent())!.startsWith('Unsubscribe');
  expect(await state()).toBe(before);
  await item.click();
  await expect(page.getByRole('status')).toContainText(before ? 'Unsubscribed' : 'Subscribed');
  await expect.poll(state).toBe(!before);
  await more(page).click();
  await expect(page.getByRole('menuitem', { name: before ? 'Subscribe' : 'Unsubscribe', exact: true })).toBeVisible();
});

test('menu: Move to project opens the project picker and moves the issue', async ({ page }) => {
  const a = await mk(page, `wb move ${stamp}`);
  await open(page, a.identifier);
  await more(page).click(); await page.getByRole('menuitem', { name: /Move to project/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Move to project' });
  await expect(dlg).toBeVisible();
  const opts = dlg.getByRole('option');
  test.skip((await opts.count()) < 2, 'demo workspace has no project');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await opts.nth(1).click();
  expect((await saved).status()).toBe(200);
  expect(((await (await page.request.get(`/api/v1/w/demo/issues/${a.id}`)).json()) as { project_id: string | null }).project_id).toBeTruthy();
});

test('menu: Make a copy creates "Copy of ..." with the same fields and opens it', async ({ page }) => {
  const a = await mk(page, `wb dup ${stamp}`, { description: 'carry **me**', priority: 2, estimate: 3 });
  await open(page, a.identifier);
  const made = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/issues'));
  await more(page).click(); await page.getByRole('menuitem', { name: 'Make a copy' }).click();
  created.push(((await (await made).json()) as { id: string }).id);
  await expect(page).toHaveURL(new RegExp(`/issue/(?!${a.identifier}$)[A-Z0-9]+-\\d+$`));
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(`Copy of wb dup ${stamp}`);
  await expect(editor(page).locator('strong')).toHaveText('me');
  const side = page.getByRole('complementary', { name: 'Properties' });
  await expect(side).toContainText('3 pts');
  await expect(side).toContainText('High');
});

test('delete dialog: Cancel and Esc keep the issue, focus returns to the menu button, Tab stays inside, Delete trashes it', async ({ page }) => {
  const a = await mk(page, `wb del ${stamp}`);
  await open(page, a.identifier);
  const dlg = page.getByRole('alertdialog', { name: `Delete ${a.identifier}?` });
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dlg.getByRole('button', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.mouse.click(5, 5); // scrim
  await expect(dlg).toBeHidden();
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.idp-banner')).toContainText('trash');
  await expect.poll(async () => (await page.request.get(`/api/v1/w/demo/issues/${a.id}`)).status()).toBe(404); // trashed issues are no longer served by id
});

test('reduced motion: the dialog and menu appear and disappear without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const a = await mk(page, `wb rm ${stamp}`);
  await open(page, a.identifier);
  await more(page).click(); await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  expect(await dlg.evaluate((e) => getComputedStyle(e).animationDuration)).toMatch(/^0s$/);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('axe: rich description, open menu and delete dialog have no wcag2a/aa violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no half-faded frames: axe samples colors at one instant
  const a = await mk(page, `wb axe ${stamp}`, { description: '## Head\n\ntext with **bold**, `code` and [a link](https://example.com)\n\n- one\n- two\n\n1. a\n2. b\n\n- [x] done\n- [ ] todo\n\n> quote\n\n```\ncode block\n```' });
  await open(page, a.identifier);
  const axe = async (label: string) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => `${label}: ${v.id} x${v.nodes.length}`)).toEqual([]);
  await editor(page).click();
  await axe('editor focused');
  await more(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await axe('menu');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await axe('dialog');
});

// Property pickers run on the Combobox primitive (anchored Popover, focus returns to the trigger).
test('pickers: priority by keyboard (type, Enter) saves and returns focus to the trigger; Esc closes without a change', async ({ page }) => {
  const a = await mk(page, `wb combo prio ${stamp}`);
  await open(page, a.identifier);
  const side = page.getByRole('complementary', { name: 'Properties' });
  const trigger = side.getByRole('button', { name: /No priority|Urgent|High|Medium|Low/ }).first();
  await trigger.click();
  const dlg = page.getByRole('dialog', { name: 'Set priority' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('combobox')).toBeFocused();
  const box = await dlg.boundingBox(); const tb = await trigger.boundingBox();
  expect(Math.abs(box!.y - (tb!.y + tb!.height))).toBeLessThan(24); // anchored under the trigger, not a floating scrim
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.keyboard.type('urg'); await page.keyboard.press('Enter');
  expect((await saved).status()).toBe(200);
  await expect(dlg).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(((await (await page.request.get(`/api/v1/w/demo/issues/${a.id}`)).json()) as { priority: number }).priority).toBe(1);
});

test('pickers: labels stay open on pick (multi), Esc closes, axe clean', async ({ page }) => {
  const a = await mk(page, `wb combo labels ${stamp}`);
  await open(page, a.identifier);
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /Add label/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Change labels' });
  await expect(dlg).toBeVisible();
  const opts = dlg.getByRole('option');
  test.skip((await opts.count()) < 1, 'demo workspace has no labels');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await opts.first().click();
  expect((await saved).status()).toBe(200);
  await expect(dlg).toBeVisible();
  await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
  const axe = await new AxeBuilder({ page }).include('[role=dialog]').analyze();
  expect(axe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
});
