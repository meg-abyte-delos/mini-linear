import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Page = import('@playwright/test').Page;
// The detail page runs on the API (demo workspace, demo session). Each test creates its own issue, so the shared DB and the other specs' titles are never touched.
const TITLE = 'Board drag and drop';
let identifier = '';
async function ownIssue(page: Page, title = TITLE) {
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const res = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, title } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { identifier: string }).identifier;
}
const ready = async (page: Page) => { identifier = await ownIssue(page); await page.goto(`/w/demo/issue/${identifier}?today=2026-10-28`); await page.waitForSelector('html[data-ready]'); };

test('detail page renders and passes axe (wcag2a/aa)', async ({ page }) => {
  await ready(page);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Board drag and drop');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
  await page.screenshot({ path: 'test-results/issue-detail.png', fullPage: true });
});

test('unknown or malformed identifier is a 404', async ({ page }) => {
  // Dynamic routes stream, so the HTTP status can be 200: assert the not-found UI instead (and no issue page).
  for (const u of ['/w/demo/issue/DEM-99999', '/w/demo/issue/not_an_id']) {
    await page.goto(u);
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
    await expect(page.locator('.idp')).toHaveCount(0);
  }
});

test('inline title, properties and activity', async ({ page }) => {
  await ready(page);
  const t = page.getByLabel('Title', { exact: true });
  await t.fill('Board DnD v2'); await t.press('Enter');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('changed the title');
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /in progress|todo|backlog|done|review/i }).first().click();
  await page.getByRole('combobox', { name: /Change status/ }).fill('done');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set status to Done');
  await page.getByLabel('Estimate').selectOption('5');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set estimate to 5');
  // The ?today= override is ignored when the server runs a production build (CI), so the page compares against the real clock.
  // Use a date that is in the past on any clock, not one relative to the pinned 2026-10-28.
  const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'), { timeout: 10_000 }).catch(() => null);
  await page.getByLabel('Due date').fill('2020-01-01');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set due date to 2020-01-01');
  await patched;
  await expect(page.getByRole('complementary', { name: 'Properties' }).locator('.due-flag')).toHaveText('Overdue');
});

test('description editor is WYSIWYG and safe: no tabs, no script/raw html, unsafe links dropped', async ({ page }) => {
  await ready(page);
  await expect(page.getByRole('tab', { name: 'Write' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveCount(0);
  const ed = page.getByRole('textbox', { name: 'Description' });
  await ed.click();
  await page.keyboard.press('Control+b'); await page.keyboard.type('bold'); await page.keyboard.press('Control+b');
  await page.keyboard.type(' <img src=x onerror=window.__x=1> [bad](javascript:alert(1)) [ok](https://linear.app)');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
  await page.getByLabel('Title', { exact: true }).click(); // blur saves
  expect((await saved).status()).toBe(200);
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(ed.locator('strong')).toHaveText('bold');
  await expect(ed.locator('img')).toHaveCount(0);
  await expect(ed.getByRole('link', { name: 'bad' })).toHaveCount(0);
  await expect(ed).toContainText('[bad](javascript:alert(1))'); // typed syntax stays literal text
  await expect(ed).toContainText('<img src=x onerror=window.__x=1>');
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
});

test('comments: mention autocomplete, reply thread, reactions', async ({ page }) => {
  await ready(page);
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await box.click(); await box.pressSequentially('hey @ada'); // mate@example.test is 'Ada Kernel' (members carry display_name)
  await expect(page.getByRole('listbox', { name: 'Mention a teammate' })).toContainText('Ada Kernel');
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue('hey @ada ');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const c = page.getByRole('article', { name: /Comment by/ }).first();
  await expect(c.locator('.mention')).toHaveText('@ada');
  // comment timestamps are relative like events, absolute date on hover
  await expect(c.locator('time.ev-age')).toHaveText(/^(now|[0-9]+m)$/);
  await expect(c.locator('time.ev-age')).toHaveAttribute('title', /^[A-Z][a-z]{2} \d{1,2}, /);
  await c.getByRole('button', { name: /React 👍/ }).click();
  await expect(c.getByRole('button', { name: 'React 👍, 1' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  const r = page.getByRole('combobox', { name: 'Reply' });
  await r.fill('on it'); await r.press('Control+Enter');
  await expect(page.locator('.replies .cmt')).toContainText('on it');
});

test('sub-issues, relations, attachments', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Add sub-issue' }).first().click();
  await page.getByLabel('New sub-issue title').fill('Write e2e');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sub-issues/ })).toContainText('0/1');
  await page.getByRole('button', { name: 'Add relation', exact: true }).click();
  await page.getByRole('menuitem', { name: /Blocks/ }).click();
  await page.getByRole('combobox', { name: /Add relation/ }).fill('Set up CI');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Relations' }).locator('..')).toContainText('Set up CI');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/relations-after.png' });
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(ax.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Link URL').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('valid http');
  await page.getByLabel('Link URL').fill('https://github.com/meg-abyte-delos/mini-linear/pull/1');
  await page.getByLabel('Link title').fill('PR #1');
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(page.getByRole('link', { name: 'PR #1' })).toHaveAttribute('href', /github.com/);
});

test('copy branch shortcut, archive and unarchive', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page.locator('body').click();
  await page.keyboard.press('Control+Shift+.');
  await expect(page.getByRole('status')).toContainText('Copied branch name');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`demo/${identifier.toLowerCase()}-board-drag-and-drop`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.locator('.idp-banner')).toContainText('Archived');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
});

test('delete and restore', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.idp-banner')).toContainText('trash');
  await expect(page.getByLabel('Title', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
});

test('comments: edit, delete, and one chronological timeline with change events', async ({ page }) => {
  await ready(page);
  const feed = page.getByRole('list', { name: 'Activity' });
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await box.fill('first **draft**');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const c = page.getByRole('article', { name: /Comment by/ }).first();
  await expect(c.locator('strong')).toHaveText('draft');
  await c.hover();
  await c.getByRole('button', { name: 'Edit comment' }).click();
  const ed = page.getByRole('combobox', { name: 'Edit comment' });
  await expect(ed).toHaveValue('first **draft**');
  await ed.fill('final _text_');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(c.locator('em')).toHaveText('text');
  await expect(c).toContainText('(edited)');
  // change events (estimate) interleave with the comment, in time order
  // The assignee change is not exercised here: the picker needs the members directory (PR 4).
  await page.getByLabel('Estimate').selectOption('3');
  const items = await feed.locator('> li').allTextContents();
  const ci = items.findIndex((t) => t.includes('final'));
  const ei = items.findIndex((t) => t.includes('set estimate to 3'));
  expect(ci).toBeGreaterThan(-1);
  expect(ei).toBeGreaterThan(ci);
  page.once('dialog', (d) => void d.accept());
  await c.hover();
  await c.getByRole('button', { name: 'Delete comment' }).click();
  await expect(page.getByRole('article', { name: /Comment by/ })).toHaveCount(0);
  await expect(feed).toContainText('deleted a comment');
});

// FIXME(PR 4, members directory): the assignee step of the timeline test was removed because the assignee picker needs the members directory.
// Restore it here once PR 4 lands: assign a member, expect 'changed the assignee' interleaved with the comment in time order.
test.fixme('timeline: assignee change interleaves with comments', async ({ page }) => {
  await ready(page);
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /assignee|unassigned/i }).first().click();
  await page.getByRole('option').first().click();
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set assignee');
});

test('D9: composer stays in view at 1280x720, activity rows carry avatars, Sub-issues/Relations/Attachments share one "+" affordance', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page);
  for (const n of ['one', 'two', 'three', 'four']) {
    const box = page.getByRole('combobox', { name: 'Leave a comment' });
    await box.fill(`Comment ${n}, long enough to look like a real remark`);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByRole('article', { name: /Comment by/ })).toHaveCount(['one', 'two', 'three', 'four'].indexOf(n) + 1);
  }
  const btn = page.getByRole('button', { name: 'Comment', exact: true });
  await expect(btn).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.feed .ev .av').first()).toBeVisible();
  await expect(page.locator('.cmt header .av').first()).toBeVisible();
  for (const name of ['Add sub-issue', 'Add relation', 'Add link']) await expect(page.getByRole('button', { name, exact: true }).first()).toHaveClass(/sec-add/);
  await page.screenshot({ path: 'test-results/d9r-1280.png' });
});
