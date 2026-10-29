import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, login, logout, apiCreateIssue, withSession } from './helpers/auth';

// Core flow against the real stack: Postgres + real sessions (ML_API=1, no ML_DEV_AUTH) + `pnpm db:seed-demo`.
// Skipped in the default mock-mode run. Spec by Tess; adapted to the real routes (/ and /w/[slug]) and labels.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_WORKSPACE_SLUG, ML_TEAM_ID and the demo seed');

// Serial: one worker, so the per-email login rate limit (10/min) is not hit.
test.describe.configure({ mode: 'serial' });

test.describe('Login', () => {
  test('valid credentials land on the app', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: /New issue/ })).toBeVisible();
  });
  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.auth-err')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login/);
  });
  test('empty form is refused', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel('Email')).toHaveJSProperty('validity.valueMissing', true);
  });
  for (const path of ['/', `/w/${DEMO.slug}/settings`]) {
    test(`protected route ${path} redirects to login when anonymous`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
  test('after login the user returns to the requested page (next)', async ({ page }) => {
    await page.goto(`/w/${DEMO.slug}/settings`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email').fill(DEMO.email);
    await page.getByLabel('Password').fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO.slug}/settings`));
  });
  test('session survives reload; logout ends it', async ({ page }) => {
    await login(page);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await logout(page);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('API without a session (the proxy skips /api, the handlers must refuse)', () => {
  for (const path of ['/api/v1/me', '/api/v1/workspaces', `/api/v1/w/${DEMO.slug}/issues`, `/api/v1/w/${DEMO.slug}/events`, `/api/v1/w/${DEMO.slug}/projects`]) {
    test(`GET ${path} is 401`, async ({ request }) => { expect((await request.get(path)).status()).toBe(401); });
  }
  test('POST issues is 401', async ({ request }) => {
    expect((await request.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: DEMO.teamId, title: 'nope' } })).status()).toBe(401);
  });
});

test.describe('Create issue', () => {
  test.beforeEach(async ({ page, browser }) => { await withSession(browser, page); });
  test('New issue creates and selects an issue', async ({ page }) => {
    const before = await page.getByText('New issue', { exact: true }).count();
    await page.getByRole('button', { name: /^New issue/ }).click();
    await expect(page.getByText('New issue', { exact: true })).toHaveCount(before + 1);
  });
  test('title with special characters is stored verbatim (no XSS)', async ({ page }) => {
    const t = `E2E <b>x</b> "q" & é ${Date.now()}`;
    await apiCreateIssue(page, t);
    await page.reload();
    await expect(page.getByText(t, { exact: true })).toBeVisible();
    await expect(page.locator('b', { hasText: 'x' })).toHaveCount(0);
  });
  test('two issues get distinct identifiers', async ({ page }) => {
    const a = await apiCreateIssue(page, `E2E idA ${Date.now()}`), b = await apiCreateIssue(page, `E2E idB ${Date.now()}`);
    expect(a.identifier).toMatch(/^DEM-\d+$/);
    expect(a.identifier).not.toBe(b.identifier);
  });
});

test.describe('Persistence after reload', () => {
  test.beforeEach(async ({ page, browser }) => { await withSession(browser, page); });
  test('issue survives reload', async ({ page }) => {
    const t = `E2E persist ${Date.now()}`;
    await apiCreateIssue(page, t);
    await page.reload();
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  });
  test('issue created from the UI survives reload', async ({ page }) => {
    const before = await page.getByText('New issue', { exact: true }).count();
    await page.getByRole('button', { name: /^New issue/ }).click();
    await expect(page.getByText('New issue', { exact: true })).toHaveCount(before + 1);
    await page.reload();
    await expect(page.getByText('New issue', { exact: true })).toHaveCount(before + 1);
  });
  test('issue survives a fresh session (new context, same user)', async ({ page, browser }) => {
    const t = `E2E fresh ${Date.now()}`;
    await apiCreateIssue(page, t);
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await login(p2);
    await expect(p2.getByText(t, { exact: true })).toBeVisible();
    await ctx.close();
  });
  test('detail page opened by URL shows the same issue', async ({ page }) => {
    const t = `E2E url ${Date.now()}`;
    const { identifier } = await apiCreateIssue(page, t);
    await page.goto(`/w/${DEMO.slug}/issue/${identifier}`);
    await expect(page.getByRole('main', { name: `Issue ${identifier}` })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(t);
  });
});
