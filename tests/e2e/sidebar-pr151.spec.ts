import { test, expect, type Page } from '@playwright/test';

// PR #151 (ui-sidebar): workspace switcher + avatar, collapsible team section. API mode, demo session.
// Depends on PR #151 being on main. Never clicks "Log out": that would revoke the shared demo session.
test.describe.configure({ mode: 'serial' });
const KEY = 'ml.side.team.open';
const home = async (page: Page) => { await page.goto('/'); await page.waitForSelector('html[data-ready]'); await expect(page.getByRole('option').first()).toBeVisible(); };
const side = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });

test.beforeEach(async ({ page }) => { await page.addInitScript((k) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.removeItem(k); } }, KEY); });

test('switcher: is a menu button, opens with Enter, lists session user, settings link and Log out', async ({ page }) => {
  await home(page);
  const btn = side(page).getByRole('button', { name: /Delos/ }).first();
  await expect(btn).toHaveAttribute('aria-haspopup', 'menu');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.focus(); await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('menu', { name: 'Workspace' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Workspace settings' })).toHaveAttribute('href', '/w/demo/settings');
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
});

test('switcher: Escape closes, outside click closes, toggling the button closes', async ({ page }) => {
  await home(page);
  const btn = side(page).getByRole('button', { name: /Delos/ }).first();
  const menu = page.getByRole('menu', { name: 'Workspace' });
  await btn.click(); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await btn.click(); await expect(menu).toBeVisible();
  await page.locator('main').click({ position: { x: 5, y: 5 } }); await expect(menu).toBeHidden();
  await btn.click(); await expect(menu).toBeVisible();
  await btn.click(); await expect(menu).toBeHidden();
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('session avatar: exposes the signed-in member name (from /me) with initials', async ({ page }) => {
  await home(page);
  const me = await (await page.request.get('/api/v1/me')).json();
  const name: string = me.name ?? me.user?.name;
  expect(name, '/me must expose a name').toBeTruthy();
  const av = side(page).getByRole('img', { name: `Signed in as ${name}` });
  await expect(av).toBeVisible();
  await expect(av).toHaveAttribute('title', name);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  await expect(av).toHaveText(initials);
  await page.getByRole('button', { name: /Delos/ }).first().click();
  await expect(page.getByRole('menu', { name: 'Workspace' })).toContainText(name);
});

test('team section: toggle has aria-expanded/aria-controls, collapses Issues/Cycles/Projects, keyboard operable', async ({ page }) => {
  await home(page);
  const toggle = side(page).locator('button.team-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-controls', 'team-nav');
  const nav = page.getByRole('navigation', { name: 'Teams' });
  for (const n of ['Issues', 'Cycles', 'Projects']) await expect(nav.getByRole('link', { name: n })).toBeVisible();
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#team-nav')).toBeHidden();
  for (const n of ['Issues', 'Cycles', 'Projects']) await expect(nav.getByRole('link', { name: n })).toBeHidden();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Cycles' })).toBeVisible();
});

test('team section: collapsed state persists in localStorage and survives reload; re-expanding stores 1', async ({ page }) => {
  await home(page);
  const toggle = side(page).locator('button.team-toggle');
  await toggle.click();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('0');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#team-nav')).toBeHidden();
  await toggle.click();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('1');
  await page.reload(); await page.waitForSelector('html[data-ready]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('team section: navigation still works inside it (Cycles then Projects then Issues), aria-current follows', async ({ page }) => {
  await home(page);
  const nav = page.getByRole('navigation', { name: 'Teams' });
  await nav.getByRole('link', { name: 'Cycles' }).click();
  await expect(nav.getByRole('link', { name: 'Cycles' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Projects' }).click();
  await expect(nav.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Cycles' })).not.toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Issues' }).click();
  await expect(nav.getByRole('link', { name: 'Issues' })).toHaveAttribute('aria-current', 'page');
});

test('storage unavailable: toggle still works in-session without throwing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await page.goto('/'); await page.waitForSelector('html[data-ready]');
  const toggle = side(page).locator('button.team-toggle');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(errors.filter((m) => /denied/.test(m))).toEqual([]);
});
