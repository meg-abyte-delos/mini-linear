import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// API mode (real Postgres, demo seed, demo session): read-only members directory.
test('members page lists the workspace members from the API and is axe clean', async ({ page }) => {
  const api = await page.request.get('/api/v1/w/demo/members?limit=100');
  expect(api.status()).toBe(200);
  const items = (await api.json()).items as { email: string; role: string }[];
  expect(items.length).toBeGreaterThan(0);

  await page.goto('/w/demo/members');
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
  const rows = page.getByTestId('member-row');
  await expect(rows).toHaveCount(items.length);
  for (const m of items) {
    const row = rows.filter({ hasText: m.email });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(new RegExp(m.role, 'i'));
  }
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
});

test('workspace menu links to the members page', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.locator('.ws-btn').click();
  await page.getByRole('menuitem', { name: 'Members' }).click();
  await expect(page).toHaveURL(/\/w\/demo\/members$/);
});
