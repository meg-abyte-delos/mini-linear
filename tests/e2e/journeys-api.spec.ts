import { test, expect, type Page } from '@playwright/test';
import { nameFromEmail } from '../../src/lib/nl-people';
import { login } from './helpers/auth';

// Journeys on the real stack (ML_API=1, demo seed, demo session): create -> assign -> cycle -> done, invite a member, mention -> Inbox.
// Written from the product contract (docs/API.md, docs/m1-routes.md), not from the implementation. Async UI state waits on the
// PATCH/POST response or polls the API/feed (no fixed sleeps). Each test creates its own issues (shared DB).
test.describe.configure({ mode: 'serial' });
const W = '/api/v1/w/demo';
const stamp = Date.now().toString(36);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let teamId: string;
test.beforeAll(async ({ request }) => { teamId = (await (await request.get(`${W}/teams`)).json()).items[0].id; });

type Issue = { id: string; identifier: string; title: string; status: string; assignee_id: string | null; cycle_id: string | null; version: number };
const mk = async (page: Page, title: string) => {
  const r = await page.request.post(`${W}/issues`, { data: { team_id: teamId, title } });
  expect(r.status()).toBe(201);
  return (await r.json()) as Issue;
};
const get = async (page: Page, id: string) => (await (await page.request.get(`${W}/issues/${id}`)).json()) as Issue;
const open = async (page: Page, ident: string) => { await page.goto(`/w/demo/issue/${ident}`); await page.waitForSelector('html[data-ready]'); await expect(page.getByLabel('Title', { exact: true })).toBeVisible(); };
const patched = (page: Page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/issues/'));
const feed = (page: Page) => page.getByRole('list', { name: 'Activity' });
// The feed refetches asynchronously after a PATCH: poll it, reloading as the fallback, instead of trusting one refetch (see members-assignee-api.spec.ts).
const feedHas = (page: Page, text: string | RegExp) => expect(async () => {
  const t = await feed(page).innerText().catch(() => '');
  if (!(typeof text === 'string' ? t.includes(text) : text.test(t))) { await page.reload(); await page.waitForSelector('html[data-ready]'); }
  await expect(feed(page)).toContainText(text, { timeout: 2000 });
}).toPass({ timeout: 20000, intervals: [500, 1000, 2000] });
// Scoped by the property row (dt label), so text inside another property button cannot match.
async function pickFromPanel(page: Page, prop: 'Status' | 'Assignee' | 'Cycle', dialog: string, option: RegExp) {
  await page.getByRole('complementary', { name: 'Properties' }).locator('dt', { hasText: new RegExp('^' + prop + '$') }).locator('xpath=following-sibling::dd[1]').getByRole('button').click();
  const dlg = page.getByRole('dialog', { name: dialog });
  await expect(dlg).toBeVisible();
  const w = patched(page);
  await dlg.getByRole('option', { name: option }).first().click();
  expect((await w).status()).toBe(200);
  await expect(dlg).toBeHidden();
}

test('journey: create, assign, put in a cycle, complete, and it all survives a reload', async ({ page }) => {
  const me = (await (await page.request.get('/api/v1/me')).json()) as { id: string };
  const members = ((await (await page.request.get(`${W}/members?limit=100`)).json()) as { items: { user_id: string; email: string }[] }).items;
  const other = members.find((m) => m.user_id !== me.id)!;
  const cycles = ((await (await page.request.get(`${W}/cycles?limit=100`)).json()) as { items: { id: string; name: string }[] }).items;
  expect(cycles.length).toBeGreaterThan(0);
  const cyc = cycles[0]!;

  const it = await mk(page, `Journey ${stamp}`);
  expect(it).toMatchObject({ status: 'backlog', assignee_id: null, cycle_id: null });
  await open(page, it.identifier);

  await pickFromPanel(page, 'Status', 'Change status', /^In Progress/i);
  expect((await get(page, it.id)).status).toBe('in_progress');
  await pickFromPanel(page, 'Assignee', 'Assign to', new RegExp(esc(nameFromEmail(other.email)), 'i'));
  expect((await get(page, it.id)).assignee_id).toBe(other.user_id);
  await pickFromPanel(page, 'Cycle', 'Move to cycle', new RegExp(esc(cyc.name)));
  expect((await get(page, it.id)).cycle_id).toBe(cyc.id);
  await pickFromPanel(page, 'Status', 'Change status', /^Done/i);
  expect(await get(page, it.id)).toMatchObject({ status: 'done', assignee_id: other.user_id, cycle_id: cyc.id });

  await feedHas(page, /changed status from In Progress to Done/);
  await page.reload(); await page.waitForSelector('html[data-ready]');
  const props = page.getByRole('complementary', { name: 'Properties' });
  await expect(props).toContainText('Done');
  await expect(props).toContainText(cyc.name);
});

test('journey: a cycle assignment can be cleared with "No cycle"', async ({ page }) => {
  const cycles = ((await (await page.request.get(`${W}/cycles?limit=100`)).json()) as { items: { id: string; name: string }[] }).items;
  const cyc = cycles[0]!;
  const it = await mk(page, `Journey cycle ${stamp}`);
  await open(page, it.identifier);
  await pickFromPanel(page, 'Cycle', 'Move to cycle', new RegExp(esc(cyc.name)));
  expect((await get(page, it.id)).cycle_id).toBe(cyc.id);
  await pickFromPanel(page, 'Cycle', 'Move to cycle', /No cycle/);
  expect((await get(page, it.id)).cycle_id).toBeNull();
});

test('error path: a stale If-Match is refused (412), a missing one is 428; the issue is unchanged', async ({ page }) => {
  const it = await mk(page, `Journey stale ${stamp}`);
  const ok = await page.request.patch(`${W}/issues/${it.id}`, { data: { status: 'todo' }, headers: { 'If-Match': String(it.version) } });
  expect(ok.status()).toBe(200);
  const stale = await page.request.patch(`${W}/issues/${it.id}`, { data: { status: 'done' }, headers: { 'If-Match': String(it.version) } });
  expect(stale.status()).toBe(412);
  const none = await page.request.patch(`${W}/issues/${it.id}`, { data: { status: 'done' } });
  expect(none.status()).toBe(428);
  expect((await get(page, it.id)).status).toBe('todo');
});

test('error path: a bogus status and a stranger assignee are refused', async ({ page }) => {
  const it = await mk(page, `Journey invalid ${stamp}`);
  const h = { 'If-Match': String(it.version) };
  expect((await page.request.patch(`${W}/issues/${it.id}`, { data: { status: 'nope' }, headers: h })).status()).toBe(422);
  const stranger = await page.request.patch(`${W}/issues/${it.id}`, { data: { assignee_id: '00000000-0000-4000-8000-0000000000aa' }, headers: h });
  expect(stranger.status()).toBe(422); // validation_failed invalid assignee_id
  expect(await get(page, it.id)).toMatchObject({ status: 'backlog', assignee_id: null });
});

test.describe('Invite a member', () => {
  const email = () => `invitee-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  type Inv = { id: string; email: string; role: string };
  const pending = async (page: Page) => ((await (await page.request.get(`${W}/invites?limit=100`)).json()) as { items: Inv[] }).items;
  test('admin invites: 201, no token in the response, one pending invite even after re-inviting', async ({ page }) => {
    const e = email();
    const r = await page.request.post(`${W}/invites`, { data: { email: e, role: 'member' } });
    expect(r.status()).toBe(201);
    const body = (await r.json()) as Inv;
    expect(body).toMatchObject({ email: e, role: 'member' });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
    expect((await page.request.post(`${W}/invites`, { data: { email: e, role: 'member' } })).status()).toBe(201);
    await expect.poll(async () => (await pending(page)).filter((i) => i.email === e).length).toBe(1);
  });
  test('validation: bad email and unknown role are 422; revoking removes the invite', async ({ page }) => {
    expect((await page.request.post(`${W}/invites`, { data: { email: 'not-an-email', role: 'member' } })).status()).toBe(422);
    expect((await page.request.post(`${W}/invites`, { data: { email: email(), role: 'god' } })).status()).toBe(422);
    const inv = (await (await page.request.post(`${W}/invites`, { data: { email: email(), role: 'guest' } })).json()) as Inv;
    expect((await page.request.delete(`${W}/invites/${inv.id}`)).status()).toBe(204);
    await expect.poll(async () => (await pending(page)).some((i) => i.id === inv.id)).toBe(false);
  });
  // mate@example.test: seeded non-admin member (scripts/demo-ids.ts, Ada Kernel), same E2E_PASSWORD as the demo user.
  test('a non-admin member cannot invite', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await login(p, 'mate@example.test');
    expect((await p.request.post(`${W}/invites`, { data: { email: email(), role: 'member' } })).status()).toBe(403);
    await ctx.close();
  });
  test('a bogus or malformed invite token is a uniform INVITE_INVALID', async ({ page }) => {
    for (const token of ['nope', 'x'.repeat(40), 12345]) {
      const r = await page.request.post('/api/v1/invites/accept', { data: { token } });
      expect(r.status()).toBe(404); // INVITE_INVALID maps to 404
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('INVITE_INVALID');
    }
  });
});

test('mention in a comment reaches the mentioned member Inbox; the author gets nothing', async ({ page, browser }) => {
  const title = `Journey mention ${stamp}`;
  const it = await mk(page, title);
  await open(page, it.identifier);
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await box.click();
  await box.pressSequentially('ping @mate please');
  const posted = page.waitForResponse((r) => /\/issues\/[^/]+\/comments$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await posted).status()).toBe(201);

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, 'mate@example.test');
  const kinds = async () => ((await (await mate.request.get(`${W}/notifications?limit=100`)).json()) as { items: { type: string; issue_id: string }[] }).items.filter((n) => n.issue_id === it.id).map((n) => n.type);
  await expect.poll(kinds).toEqual(['mention']);
  await mate.goto('/?view=inbox'); await mate.waitForSelector('html[data-ready]');
  const row = mate.getByRole('option').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('mentioned you');
  await ctx.close();
  const own = (await (await page.request.get(`${W}/notifications?limit=100`)).json()) as { items: { issue_id: string }[] };
  expect(own.items.filter((n) => n.issue_id === it.id)).toHaveLength(0);
});
