import { test, expect, type Page } from '@playwright/test';
import { DEMO, PROJECTS, TEAM, USERS } from '../../scripts/demo-ids';

// PR #157 (ui-list): hover checkbox, project chip, real assignee, contextual date, collapsible groups, Filter + Display. API mode, demo session.
// Depends on PR #157 being on main. Creates its own issues (shared DB, other specs move seeded rows).
test.describe.configure({ mode: 'serial' });
const stamp = Date.now().toString(36);
const T = { rich: `list rich ${stamp}`, urgent: `list urgent ${stamp}`, plain: `list plain ${stamp}` };
let richId: string;

const home = async (page: Page, qs = '') => { await page.goto(`/${qs}`); await page.waitForSelector('html[data-ready]'); await expect(page.getByRole('option').first()).toBeVisible(); };
const rowOf = (page: Page, title: string) => page.locator('.row', { hasText: title });
const group = (page: Page, name: string) => page.locator('section.group', { has: page.locator('h2', { hasText: name }) });

test.beforeAll(async ({ request }) => {
  const mk = async (data: Record<string, unknown>) => { const r = await request.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: TEAM, status: 'todo', ...data } }); expect(r.status()).toBe(201); return (await r.json()) as { id: string }; };
  richId = (await mk({ title: T.rich, assignee_id: USERS.admin.id, project_id: PROJECTS.p1, priority: 4 })).id;
  await mk({ title: T.urgent, priority: 1 });
  await mk({ title: T.plain });
});

test('row: checkbox is hidden until hover/focus, then visible; selecting keeps it visible', async ({ page }) => {
  await home(page);
  const row = rowOf(page, T.plain); const box = row.locator('.rowsel');
  // The list may focus a row on load (j/k), which shows its checkbox via :focus-within.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await expect(box).toHaveCSS('opacity', '0');
  await row.hover();
  await expect(box).toHaveCSS('opacity', '1');
  await box.click();
  await expect(row).toHaveAttribute('data-multi', /.*/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  await expect(box).toHaveCSS('opacity', '1');
  await box.click();
  await expect(row).not.toHaveAttribute('data-multi', /.*/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // clicking the box focuses the row (focus-within keeps it visible, by design)
  await page.mouse.move(0, 0);
  await expect(box).toHaveCSS('opacity', '0');
});

test('row: project chip, API assignee avatar with name tooltip, contextual date "Today" with full date in title', async ({ page }) => {
  await home(page);
  const row = rowOf(page, T.rich);
  await expect(row.locator('.chip.proj')).toHaveText('Mini Linear');
  await expect(row.locator('[title="Demo Admin"]')).toBeVisible();
  await expect(row.locator('.av-none-ic')).toHaveCount(0);
  await expect(row.locator('.date')).toHaveText('Today');
  expect(await row.locator('.date').getAttribute('title')).toBeTruthy();
  const none = rowOf(page, T.plain);
  await expect(none.locator('[title="Unassigned"] .av-none-ic')).toBeVisible();
  await expect(none.locator('.chip.proj')).toHaveCount(0);
});

test('row: an issue assigned to another member shows an avatar for that member (not unassigned)', async ({ page }) => {
  const r = await page.request.get(`/api/v1/w/${DEMO.slug}/issues/${richId}`);
  const cur = await r.json();
  const p = await page.request.patch(`/api/v1/w/${DEMO.slug}/issues/${richId}`, { data: { assignee_id: USERS.mate.id }, headers: { 'If-Match': String(cur.version) } });
  expect(p.ok()).toBe(true);
  await home(page);
  // FINDING: /members returns no display name, so other members are labelled from their email local part ("Mate"/"M"), not "Ada Kernel"/"AK" as the session user is.
  const av = rowOf(page, T.rich).locator('.av-wrap');
  await expect(av).toBeVisible();
  await expect(av).toHaveAttribute('title', /^mate$/i);
  await expect(av.locator('.av')).toHaveText('M');
  await expect(rowOf(page, T.rich).locator('.av-none-ic')).toHaveCount(0);
});

test('group header: toggle has aria-expanded/aria-controls, collapses the list, keeps the count, keyboard operable', async ({ page }) => {
  await home(page);
  const g = group(page, 'Todo');
  const toggle = g.locator('button.gh-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const ctl = (await toggle.getAttribute('aria-controls'))!;
  await expect(page.locator(`#${ctl}`)).toBeVisible();
  const count = await g.locator('.count').innerText();
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`#${ctl}`)).toHaveCount(0);
  await expect(rowOf(page, T.plain)).toHaveCount(0);
  await expect(g.locator('.count')).toHaveText(count);
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(rowOf(page, T.plain)).toBeVisible();
  // collapsing one group leaves the others alone
  await toggle.click();
  await expect(group(page, 'Backlog').locator('button.gh-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('group header "+": creates an issue in that status, keyboard reachable, labelled, and it persists in that group after reload', async ({ page }) => {
  await home(page);
  const n = () => group(page, 'Todo').locator('.row').count();
  const before = await n();
  const add = group(page, 'Todo').getByRole('button', { name: 'Add issue to Todo' });
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/issues$/.test(r.url()));
  await add.focus(); await expect(add).toBeVisible();
  await page.keyboard.press('Enter');
  expect((await created).status()).toBe(201);
  await expect.poll(n).toBe(before + 1);
  await page.waitForTimeout(800); // let the status PATCH that follows the create land (API create has no status field)
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect.poll(n).toBe(before + 1);
});

test('toolbar: no always-on pills; one Filter button opens a labelled menu with the 6 kinds; Escape closes and refocuses', async ({ page }) => {
  await home(page);
  for (const k of ['status', 'priority', 'assignee', 'label', 'project', 'cycle']) await expect(page.locator(`#fb-${k}`)).toHaveCount(0);
  const btn = page.locator('#fb-add');
  await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
  await btn.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Filter by' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Status', 'Priority', 'Assignee', 'Label', 'Project', 'Cycle']);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(btn).toBeFocused();
});

test('filter via menu: pick Status > Todo applies chip + URL; chip keeps #fb-status; menu item becomes #fb-m-status; reload restores', async ({ page }) => {
  await home(page);
  await page.locator('#fb-add').click();
  await page.getByRole('menuitem', { name: 'Status' }).click();
  await page.getByRole('option', { name: /^Todo/ }).click();
  await page.mouse.click(700, 650); // outside click closes the picker (Escape does not after an option click: see the fixme below)
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/status=todo/);
  await expect(page.locator('#fb-status')).toHaveText(/Status: Todo/);
  await expect(page.locator('#fb-status')).toHaveAttribute('aria-pressed', 'true');
  await expect(rowOf(page, T.plain)).toBeVisible();
  await expect(page.locator('.row .id').first()).toBeVisible();
  await page.locator('#fb-add').click();
  await expect(page.locator('#fb-m-status')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(page.locator('#fb-status')).toHaveText(/Status: Todo/);
  await expect(page.locator('#fb-priority')).toHaveCount(0);
});

test('filter from URL with no match leaves an empty list and a working Filter button', async ({ page }) => {
  await page.goto(`/?assignee=${USERS.guest.id}&status=done`);
  await page.waitForSelector('html[data-ready]');
  await expect(page.locator('.row')).toHaveCount(0);
  await expect(page.locator('#fb-add')).toBeVisible();
});

test('Display: popover dialog; Grouping "No grouping" -> single "All issues" group without "+"; back to Status restores groups', async ({ page }) => {
  await home(page);
  const btn = page.locator('#fb-display');
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
  await btn.focus(); await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog', { name: 'Display options' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Grouping')).toBeFocused();
  await expect(dlg.getByLabel('Grouping')).toHaveValue('status');
  await dlg.getByLabel('Grouping').selectOption('none');
  await expect(page.getByRole('heading', { name: /All issues/ })).toBeVisible();
  await expect(page.locator('section.group')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Add issue to / })).toHaveCount(0);
  await expect(rowOf(page, T.plain)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden(); await expect(btn).toBeFocused();
  await btn.click(); await dlg.getByLabel('Grouping').selectOption('status');
  expect(await page.locator('section.group').count()).toBeGreaterThan(1);
});

test('Display: Ordering Priority puts Urgent before Low/none inside a group; Created puts newest first; Manual restores', async ({ page }) => {
  await home(page);
  await page.locator('#fb-display').click();
  const dlg = page.getByRole('dialog', { name: 'Display options' });
  await dlg.getByLabel('Ordering').selectOption('priority');
  await page.keyboard.press('Escape');
  const titles = async () => (await group(page, 'Todo').locator('.row .title').allInnerTexts());
  let t = await titles();
  expect(t.indexOf(T.urgent), 'urgent before low-priority').toBeLessThan(t.indexOf(T.rich));
  expect(t.indexOf(T.rich), 'low before none').toBeLessThan(t.indexOf(T.plain));
  await page.locator('#fb-display').click();
  await dlg.getByLabel('Ordering').selectOption('created');
  await page.keyboard.press('Escape');
  t = await titles();
  expect(t.indexOf(T.plain), 'newest first').toBeLessThan(t.indexOf(T.urgent));
  await page.locator('#fb-display').click();
  await dlg.getByLabel('Ordering').selectOption('manual');
  await expect(dlg.getByLabel('Ordering')).toHaveValue('manual');
});

test('Display button only exists in list view (not board)', async ({ page }) => {
  await home(page);
  await expect(page.locator('#fb-display')).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('#fb-display')).toHaveCount(0);
  await expect(page.locator('#fb-add')).toBeVisible();
});

// FINDING (pre-existing on main, same via the old chip path): after clicking an option in a filter picker, focus falls to <body> so Escape no longer closes the picker (keyboard users are stuck until an outside click).
test.fixme('filter picker: Escape closes it after an option was chosen', async ({ page }) => {
  await home(page, '?priority=2');
  await page.locator('#fb-priority').click();
  await page.getByRole('option', { name: /^Urgent/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
