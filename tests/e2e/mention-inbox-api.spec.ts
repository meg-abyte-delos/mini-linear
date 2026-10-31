import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue, login } from './helpers/auth';

// Real stack (ML_API=1 + demo seed): the demo admin mentions the seeded member `mate` (mate@example.test => @mate) in a comment through the UI,
// then `mate` signs in on its own context and finds a 'mentioned you' row in the inbox. Unrelated people are not notified.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

const MATE = 'mate@example.test';

test('a comment mention creates an inbox notification for the mentioned member', async ({ page, browser }) => {
  const title = `mention-${Date.now()}`;
  const issue = await apiCreateIssue(page, title);
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const box = page.getByRole('textbox', { name: 'Leave a comment' });
  await box.click();
  await box.pressSequentially('please look @mate now');
  const posted = page.waitForResponse((r) => /\/issues\/[^/]+\/comments$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await posted).status()).toBe(201);

  // The mentioned member signs in separately (own cookie jar).
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, MATE);
  await mate.goto('/?view=inbox');
  await mate.waitForSelector('html[data-ready]');
  const row = mate.getByRole('option').filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('mentioned you');
  // Avatar initials come from the actor full name (display_name), not the email local part.
  const first = (await (await mate.request.get(`/api/v1/w/${DEMO.slug}/notifications?limit=100`)).json()) as { items: { issue_id: string; actor: { email: string; display_name?: string | null } | null }[] };
  const full = first.items.find((n) => n.issue_id === issue.id)?.actor?.display_name?.trim();
  if (full) {
    const w = full.split(' ').filter(Boolean);
    const want = (w.length === 1 ? [...w[0]!].slice(0, 2).join('') : [...w[0]!][0]! + [...w[w.length - 1]!][0]!).toUpperCase();
    await expect(row.locator('.av')).toHaveText(want);
  }
  // API agrees: one 'mention' on this issue, tied to a comment.
  const j = (await (await mate.request.get(`/api/v1/w/${DEMO.slug}/notifications?limit=100`)).json()) as { items: { type: string; issue_id: string; comment_id: string | null }[] };
  const mine = j.items.filter((n) => n.issue_id === issue.id);
  expect(mine.map((n) => n.type)).toEqual(['mention']);
  expect(mine[0]?.comment_id).toBeTruthy();
  await ctx.close();

  // The author never notifies self.
  const own = (await (await page.request.get(`/api/v1/w/${DEMO.slug}/notifications?limit=100`)).json()) as { items: { issue_id: string }[] };
  expect(own.items.filter((n) => n.issue_id === issue.id)).toHaveLength(0);
});
