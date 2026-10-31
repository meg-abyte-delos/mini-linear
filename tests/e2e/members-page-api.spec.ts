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
  await expect(page.getByRole('columnheader', { name: 'Joined' })).toBeVisible();
  // Row actions are a square 32x32 target in their own column, never squeezed by the role cell.
  const btns = rows.getByRole('button', { name: /^Actions for / });
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = await btns.nth(i).boundingBox();
    expect(Math.round(b!.width)).toBe(32);
    expect(Math.round(b!.height)).toBe(32);
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
