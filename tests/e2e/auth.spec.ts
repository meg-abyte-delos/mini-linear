import { test, expect } from '@playwright/test';

test('login form posts credentials and honours a safe next', async ({ page }) => {
  let body = '';
  await page.route('**/api/v1/auth/login', async (r) => { body = r.request().postData() ?? ''; await r.fulfill({ status: 200, json: { status: 'ok' } }); });
  await page.route('**/w/acme', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));
  await page.goto('/login?next=%2Fw%2Facme');
  await page.getByLabel('Email').fill('Me@Example.com');
  await page.getByLabel('Password').fill('correct horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/w/acme');
  expect(JSON.parse(body)).toEqual({ email: 'me@example.com', password: 'correct horse' });
});

test('login shows a generic error on 401', async ({ page }) => {
  await page.route('**/api/v1/auth/login', (r) => r.fulfill({ status: 401, json: { error: { code: 'unauthenticated' } } }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('a@b.co');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.auth-err')).toHaveText('Invalid email or password.');
});

test('signup shows the check-your-email state on 202', async ({ page }) => {
  await page.route('**/api/v1/auth/signup', (r) => r.fulfill({ status: 202, json: { status: 'accepted' } }));
  await page.goto('/signup');
  await page.getByLabel('Email').fill('new@b.co');
  await page.getByLabel('Password').fill('longenough1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
});
