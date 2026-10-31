import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue, login } from './helpers/auth';

// Delete authorisation on comments (deleteComment: author or admin only). Real stack: the demo admin writes the comment,
// the seeded non-admin member `mate` (mate@example.test) must neither see a Delete button nor be able to delete it through the API.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

test("a member sees no Delete button on someone else's comment and the server answers 403 to their DELETE", async ({ page, browser }) => {
  const issue = await apiCreateIssue(page, `comment-authz-${Date.now()}`);
  const text = `admin comment ${Date.now()}`;
  const created = await page.request.post(`/api/v1/w/${DEMO.slug}/issues/${issue.id}/comments`, { data: { body: text } });
  expect(created.status()).toBe(201);
  const comment = (await created.json()) as { id: string; version: number };

  // Control: the author (admin) does get the Delete button on their own comment.
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const own = page.getByRole('article', { name: /Comment by/ }).filter({ hasText: text });
  await expect(own).toHaveCount(1);
  await own.hover();
  await expect(own.getByRole('button', { name: 'Delete comment' })).toBeVisible();

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, 'mate@example.test');
  await mate.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await mate.waitForSelector('html[data-ready]');
  const theirs = mate.getByRole('article', { name: /Comment by/ }).filter({ hasText: text });
  await expect(theirs).toHaveCount(1);
  await theirs.hover();
  await expect(theirs.getByRole('button', { name: 'Delete comment' })).toHaveCount(0);
  await expect(theirs.getByRole('button', { name: 'Edit comment' })).toHaveCount(0);

  const res = await mate.request.delete(`/api/v1/w/${DEMO.slug}/comments/${comment.id}`, { headers: { 'if-match': `"${comment.version}"` } });
  expect(res.status()).toBe(403);

  // Nothing was deleted: the comment is still there for the author.
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('article', { name: /Comment by/ }).filter({ hasText: text })).toHaveCount(1);
  await ctx.close();
});
