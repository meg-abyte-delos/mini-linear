import { test, expect, type Browser, type Page } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue, login } from './helpers/auth';

// Acceptance spec for threaded comments, written from the product spec (Linear: one level of replies under a root comment),
// not from the current implementation. UI contract the builder must meet:
//  - a root comment with replies shows a toggle button named "<N> reply|replies" (aria-expanded), expanded by default;
//  - collapsing hides the replies and keeps the count; expanding shows them again; state is per thread;
//  - a reply nests inside the root's thread container (role=group name "Thread"), never as a new root;
//  - "Resolve thread" / "Reopen thread" buttons on the root: resolving collapses the thread (replies hidden, "Resolved" marker visible);
//  - resolved state is server-side and survives reload; the collapsed state of an unresolved thread is not persisted.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

const MATE = 'mate@example.test';
const INBOX = 'inbox@example.test';
const base = `/api/v1/w/${DEMO.slug}`;
const COMMENTS_POST = /\/issues\/[^/]+\/comments$/;

async function as(browser: Browser, email: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}
async function comment(page: Page, issueId: string, body: string, parent: string | null = null) {
  const r = await page.request.post(`${base}/issues/${issueId}/comments`, { data: { body, parent_comment_id: parent } });
  expect(r.status()).toBe(201);
  return (await r.json()) as { id: string };
}
async function open(page: Page, identifier: string) {
  await page.goto(`/w/${DEMO.slug}/issue/${identifier}`);
  await page.waitForSelector('html[data-ready]');
}
const thread = (page: Page, rootText: string) => page.getByRole('group', { name: 'Thread' }).filter({ hasText: rootText });
async function replyVia(t: ReturnType<typeof thread>, text: string) {
  await t.getByRole('button', { name: 'Reply', exact: true }).click();
  const box = t.getByRole('combobox', { name: 'Reply' }).or(t.getByLabel('Reply', { exact: true }));
  await box.click();
  await box.pressSequentially(text);
  await t.getByRole('button', { name: /^(Reply|Comment)$/ }).last().click();
}

test('reply through the UI nests under its root, with a count toggle', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-ui-${Date.now()}`);
  await comment(page, issue.id, 'ROOT-A first');
  await comment(page, issue.id, 'ROOT-B second');
  await open(page, issue.identifier);
  const a = thread(page, 'ROOT-A first');
  const posted = page.waitForResponse((r) => COMMENTS_POST.test(r.url()) && r.request().method() === 'POST');
  await replyVia(a, 'REPLY-A1');
  const body = (await (await posted).json()) as { parent_comment_id: string | null };
  expect(body.parent_comment_id).toBeTruthy();
  await expect(a.getByText('REPLY-A1')).toBeVisible();
  await expect(a.getByRole('button', { name: '1 reply' })).toHaveAttribute('aria-expanded', 'true');
  await expect(thread(page, 'ROOT-B second').getByText('REPLY-A1')).toHaveCount(0);
  await expect(thread(page, 'ROOT-B second').getByRole('button', { name: /repl(y|ies)$/ })).toHaveCount(0);
});

test('collapse and expand keep the reply count, per thread, and survive reload', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-collapse-${Date.now()}`);
  const a = await comment(page, issue.id, 'ROOT-A collapse');
  await comment(page, issue.id, 'REPLY-A1', a.id);
  await comment(page, issue.id, 'REPLY-A2', a.id);
  const b = await comment(page, issue.id, 'ROOT-B collapse');
  await comment(page, issue.id, 'REPLY-B1', b.id);
  await open(page, issue.identifier);
  const ta = thread(page, 'ROOT-A collapse'), tb = thread(page, 'ROOT-B collapse');
  await expect(ta.getByRole('button', { name: '2 replies' })).toHaveAttribute('aria-expanded', 'true');
  await expect(tb.getByRole('button', { name: '1 reply' })).toBeVisible();
  await ta.getByRole('button', { name: '2 replies' }).click();
  await expect(ta.getByRole('button', { name: '2 replies' })).toHaveAttribute('aria-expanded', 'false');
  await expect(ta.getByText('REPLY-A1')).toBeHidden();
  await expect(ta.getByText('REPLY-A2')).toBeHidden();
  await expect(ta.getByText('ROOT-A collapse')).toBeVisible();
  await expect(tb.getByText('REPLY-B1')).toBeVisible();
  await ta.getByRole('button', { name: '2 replies' }).click();
  await expect(ta.getByText('REPLY-A2')).toBeVisible();
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await expect(thread(page, 'ROOT-A collapse').getByRole('button', { name: '2 replies' })).toBeVisible();
  await expect(thread(page, 'ROOT-A collapse').getByText('REPLY-A1')).toBeVisible();
});

test('a reply made while the thread is collapsed bumps the count and re-opens it', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-bump-${Date.now()}`);
  const a = await comment(page, issue.id, 'ROOT-A bump');
  await comment(page, issue.id, 'REPLY-1', a.id);
  await open(page, issue.identifier);
  const t = thread(page, 'ROOT-A bump');
  await t.getByRole('button', { name: '1 reply' }).click();
  await expect(t.getByText('REPLY-1')).toBeHidden();
  await replyVia(t, 'REPLY-2');
  await expect(t.getByRole('button', { name: '2 replies' })).toHaveAttribute('aria-expanded', 'true');
  await expect(t.getByText('REPLY-2')).toBeVisible();
});

test('resolving a thread collapses it, survives reload, and reopening restores it', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-resolve-${Date.now()}`);
  const a = await comment(page, issue.id, 'ROOT-A resolve');
  await comment(page, issue.id, 'REPLY-R1', a.id);
  await open(page, issue.identifier);
  const t = () => thread(page, 'ROOT-A resolve');
  const res = page.waitForResponse((r) => /\/comments\/[^/]+\/resolve$/.test(r.url()) && r.request().method() === 'POST');
  await t().getByRole('button', { name: 'Resolve thread' }).click();
  expect((await res).ok()).toBe(true);
  await expect(t().getByText('Resolved')).toBeVisible();
  await expect(t().getByText('REPLY-R1')).toBeHidden();
  await expect(t().getByRole('button', { name: '1 reply' })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await expect(t().getByText('Resolved')).toBeVisible();
  await expect(t().getByText('REPLY-R1')).toBeHidden();
  await t().getByRole('button', { name: 'Reopen thread' }).click();
  await expect(t().getByText('REPLY-R1')).toBeVisible();
  await expect(t().getByText('Resolved')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await expect(t().getByText('REPLY-R1')).toBeVisible();
});

test('a reply to a resolved thread reopens it (server rule)', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-reopen-${Date.now()}`);
  const a = await comment(page, issue.id, 'ROOT-A reopen');
  expect((await page.request.post(`${base}/comments/${a.id}/resolve`)).ok()).toBe(true);
  await comment(page, issue.id, 'REPLY-late', a.id);
  await open(page, issue.identifier);
  await expect(thread(page, 'ROOT-A reopen').getByText('REPLY-late')).toBeVisible();
  await expect(thread(page, 'ROOT-A reopen').getByText('Resolved')).toHaveCount(0);
});

test('threads are one level deep and stay on one issue (API)', async ({ page }) => {
  const issue = await apiCreateIssue(page, `thread-depth-${Date.now()}`);
  const a = await comment(page, issue.id, 'ROOT');
  const r = await comment(page, issue.id, 'REPLY', a.id);
  const bad = await page.request.post(`${base}/issues/${issue.id}/comments`, { data: { body: 'nested', parent_comment_id: r.id } });
  expect(bad.status()).toBeGreaterThanOrEqual(400);
  expect(bad.status()).toBeLessThan(500);
  const other = await apiCreateIssue(page, `thread-depth-other-${Date.now()}`);
  const cross = await page.request.post(`${base}/issues/${other.id}/comments`, { data: { body: 'cross', parent_comment_id: a.id } });
  expect(cross.status()).toBeGreaterThanOrEqual(400);
  expect(cross.status()).toBeLessThan(500);
});

test('reply notifies the parent author and earlier participants, and the UI says "replied"', async ({ page, browser }) => {
  const issue = await apiCreateIssue(page, `thread-notify-${Date.now()}`);
  const mate = await as(browser, MATE);
  const inbox = await as(browser, INBOX);
  try {
    const root = await comment(mate.page, issue.id, 'ROOT by mate');
    await comment(inbox.page, issue.id, 'REPLY by inbox tester', root.id);
    await comment(page, issue.id, 'REPLY by admin', root.id);
    const mine = async (p: Page) => {
      const j = (await (await p.request.get(`${base}/notifications?limit=100`)).json()) as { items: { type: string; issue_id: string; comment_id: string | null; coalesced_count: number }[] };
      return j.items.filter((n) => n.issue_id === issue.id);
    };
    // Parent author (mate) is told about both replies; the earlier participant (inbox tester) about the later one.
    // Notifications coalesce per issue and type: count the underlying events, not the rows.
    const events = (ns: { type: string; coalesced_count: number }[]) => ns.filter((n) => n.type === 'reply').reduce((a, n) => a + (n.coalesced_count || 1), 0);
    expect(events(await mine(mate.page))).toBe(2);
    expect(events(await mine(inbox.page))).toBe(1);
    // Nobody is notified of their own reply: mate/inbox wrote 1 of the 2 replies each way.
    expect(events(await mine(page))).toBeLessThanOrEqual(1);
    await mate.page.goto('/?view=inbox');
    await mate.page.waitForSelector('html[data-ready]');
    await expect(mate.page.getByRole('option').filter({ hasText: issue.identifier }).first()).toContainText(/repl/i);
  } finally { await mate.ctx.close(); await inbox.ctx.close(); }
});
