import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue, login } from './helpers/auth';

// UI review 01:00: Inbox detail shows the issue Activity + composer, system rows get a calendar glyph, Projects show the status once per row.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

test('Inbox detail: Activity feed and comment composer under the description', async ({ page, browser }) => {
  const title = `inbox-activity-${Date.now()}`;
  const issue = await apiCreateIssue(page, title);
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await box.click();
  await box.pressSequentially('ping @mate');
  const posted = page.waitForResponse((r) => /\/issues\/[^/]+\/comments$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  expect((await posted).status()).toBe(201);

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, 'mate@example.test');
  await mate.goto('/?view=inbox');
  await mate.waitForSelector('html[data-ready]');
  await mate.getByRole('option').filter({ hasText: title }).click();
  const detail = mate.getByRole('complementary', { name: 'Notification detail' });
  await expect(detail.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(detail.getByRole('article', { name: /Comment by/ }).first()).toContainText('ping @mate');
  const reply = detail.getByRole('combobox', { name: 'Leave a comment' });
  await expect(reply).toBeVisible();
  await reply.fill('seen from the inbox');
  await detail.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(detail.getByRole('article', { name: /Comment by/ }).filter({ hasText: 'seen from the inbox' })).toHaveCount(1);
  await ctx.close();
});

test('Inbox system rows (due soon) use a calendar glyph, not an empty ring', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  const sys = page.locator('.nrow .nav-av[data-kind=system]');
  for (let i = 0; i < await sys.count(); i++) {
    await expect(sys.nth(i).locator('svg rect')).toHaveCount(1);
    await expect(sys.nth(i).locator('svg circle')).toHaveCount(0);
  }
});

test('Projects: status icon only in the Status column, folder glyph in the name cell', async ({ page }) => {
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  const rows = page.locator('.pj-row');
  await expect(rows.first()).toBeVisible();
  for (let i = 0; i < await rows.count(); i++) {
    await expect(rows.nth(i).locator('.psi')).toHaveCount(1);
    await expect(rows.nth(i).locator('.cy-name .psi')).toHaveCount(0);
    await expect(rows.nth(i).locator('.pj-stat .psi')).toHaveCount(1);
  }
});
