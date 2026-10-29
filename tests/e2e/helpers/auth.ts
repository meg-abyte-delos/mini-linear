import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// API-mode e2e (ML_API=1, real Postgres, no dev auth). The user comes from `pnpm db:seed-demo` (workspace `demo`, team DEM).
export const API_MODE = process.env.ML_API === '1' && process.env.ML_DEV_AUTH !== '1';
export const DEMO = { email: process.env.E2E_EMAIL ?? 'demo@example.test', password: process.env.E2E_PASSWORD ?? 'demo-password-123', slug: process.env.ML_WORKSPACE_SLUG ?? 'demo', teamId: process.env.ML_TEAM_ID ?? '' };

export async function login(page: Page, email = DEMO.email, password = DEMO.password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.waitForSelector('html[data-ready]');
}

// There is no logout button in the UI yet: the API route is the logout.
export async function logout(page: Page) {
  const res = await page.request.post('/api/v1/auth/logout');
  expect(res.ok()).toBeTruthy();
}

// Creates an issue through the API as the logged-in user (same cookie jar as the page).
export async function apiCreateIssue(page: Page, title: string): Promise<{ id: string; version: number; identifier: string }> {
  const res = await page.request.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: DEMO.teamId, title } });
  expect(res.status()).toBe(201);
  return res.json();
}

// Login is rate limited (10/min per email): sign in once per worker and reuse the cookies for tests that only need a session.
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined;
export async function withSession(browser: Browser, page: Page) {
  if (!cookies) {
    const ctx = await browser.newContext();
    await login(await ctx.newPage());
    cookies = await ctx.cookies();
    await ctx.close();
  }
  await page.context().addCookies(cookies);
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
}
