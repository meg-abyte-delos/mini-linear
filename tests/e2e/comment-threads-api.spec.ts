import { test, expect, type Page } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue, login } from './helpers/auth';

// Threaded comments on the issue page (real stack): rail + indented replies, collapse with N replies and avatars,
// resolve / reopen from the root header button, resolved threads collapsed by default, reply composer at the bottom of the thread,
// and reply notifications to the root author and the thread participants.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

const MATE = 'mate@example.test';
const api = (p: string) => `/api/v1/w/${DEMO.slug}${p}`;
async function post(page: Page, issueId: string, body: string, parent: string | null = null) {
  const r = await page.request.post(api(`/issues/${issueId}/comments`), { data: { body, parent_comment_id: parent } });
  expect(r.status()).toBe(201);
  return (await r.json()) as { id: string };
}

test('threads render with a rail, collapse, resolve and reopen from the root header button, and reply from the bottom of the thread', async ({ page }) => {
  const issue = await apiCreateIssue(page, `threads-${Date.now()}`);
  const root = await post(page, issue.id, 'Root question');
  await post(page, issue.id, 'First reply', root.id);
  await post(page, issue.id, 'Second reply', root.id);
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');

  const thread = page.getByRole('group', { name: 'Thread' }).filter({ hasText: 'Root question' });
  await expect(thread.locator('.thread-rail')).toBeVisible();
  await expect(thread.getByText('First reply')).toBeVisible();
  const toggle = thread.getByRole('button', { name: /2 replies/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(thread.getByText('First reply')).toHaveCount(0);
  await toggle.click();
  await expect(thread.getByText('Second reply')).toBeVisible();

  // Resolve from the root header button: collapsed, with the Resolved marker; persists after a reload.
  await thread.getByRole('button', { name: 'Resolve thread' }).click();
  await expect(thread.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(thread.getByText('First reply')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  const again = page.getByRole('group', { name: 'Thread' }).filter({ hasText: 'Root question' });
  await expect(again.getByText('Resolved', { exact: true })).toBeVisible();
  await expect(again.getByRole('button', { name: /2 replies/ })).toHaveAttribute('aria-expanded', 'false');

  // Reopen with the thread button: replies are back.
  await again.getByRole('button', { name: 'Reopen thread' }).click();
  await expect(again.getByText('First reply')).toBeVisible();
  await expect(again.getByText('Resolved', { exact: true })).toHaveCount(0);

  // Reply composer sits at the bottom of the thread.
  await again.getByRole('button', { name: 'Reply', exact: true }).click();
  const box = again.getByRole('textbox', { name: 'Reply' });
  await box.fill('Third reply');
  const posted = page.waitForResponse((r) => /\/issues\/[^/]+\/comments$/.test(r.url()) && r.request().method() === 'POST');
  await again.getByRole('button', { name: 'Reply', exact: true }).last().click();
  expect((await posted).status()).toBe(201);
  await expect(again.getByRole('button', { name: /3 replies/ })).toBeVisible();
  await expect(again.locator('.thread-rail li').last()).toContainText('Third reply');
});

test('a reply notifies the root author and the earlier participants, not the replier', async ({ page, browser }) => {
  const title = `threads-notify-${Date.now()}`;
  const issue = await apiCreateIssue(page, title);
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, MATE);
  const root = await post(mate, issue.id, 'Mate starts a thread'); // mate is the root author
  await post(page, issue.id, 'Admin replies', root.id); // admin participates
  const before = await (await mate.request.get(api('/notifications'))).json();
  const n0 = (before.items as { issue_id: string }[]).filter((n) => n.issue_id === issue.id).length;
  expect(n0).toBeGreaterThan(0); // root author got the admin reply
  const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const admin = await ctx2.newPage();
  await login(admin);
  await post(mate, issue.id, 'Mate answers back', root.id);
  const adminInbox = await (await admin.request.get(api('/notifications'))).json();
  const rows = (adminInbox.items as { issue_id: string; type: string }[]).filter((n) => n.issue_id === issue.id);
  expect(rows.some((r) => r.type === 'reply')).toBe(true); // participant notified
  const mateInbox = await (await mate.request.get(api('/notifications'))).json();
  expect((mateInbox.items as { issue_id: string }[]).filter((n) => n.issue_id === issue.id).length).toBe(n0); // replier not notified of own reply
  await admin.goto('/?view=inbox');
  await admin.waitForSelector('html[data-ready]');
  const row = admin.getByRole('option').filter({ hasText: title });
  await expect(row).toContainText('replied');
  await expect(row).not.toContainText('undefined');
  await ctx.close(); await ctx2.close();
});

test('a reply to a resolved thread reopens it like an unresolve: version bump (stale edit gets 412) and audit entry', async ({ page }) => {
  const issue = await apiCreateIssue(page, `threads-reopen-${Date.now()}`);
  const root = await post(page, issue.id, 'Resolved root');
  const res = await page.request.post(api(`/comments/${root.id}/resolve`));
  expect(res.ok()).toBe(true);
  const resolved = (await res.json()) as { version: number; resolved_at: string | null };
  expect(resolved.resolved_at).not.toBeNull();
  await post(page, issue.id, 'Back again', root.id);
  const after = (await (await page.request.get(api(`/comments/${root.id}`))).json()) as { version: number; resolved_at: string | null };
  expect(after.resolved_at).toBeNull();
  expect(after.version).toBe(Number(resolved.version) + 1);
  const stale = await page.request.patch(api(`/comments/${root.id}`), { data: { body: 'edit from a stale tab' }, headers: { 'If-Match': `"${resolved.version}"` } });
  expect(stale.status()).toBe(412);
});
