import { test, expect, type Page } from '@playwright/test';

// Regression for the strict style-src 'self' policy and for hydration errors: no CSP violation, console error or page error
// on the main pages. (404 resource noise is ignored: only app errors count.)
function watch(page: Page): string[] {
  const bad: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/Failed to load resource/i.test(t)) return;
    bad.push(`${m.type()}: ${t.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => bad.push(`pageerror: ${e.message.slice(0, 300)}`));
  return bad;
}

const PAGES: { name: string; url: string; ready: (p: Page) => Promise<void> }[] = [
  { name: 'list', url: '/', ready: (p) => expect(p.getByRole('option').first()).toBeVisible() },
  { name: 'issue page', url: '/w/demo/issue/DEM-1', ready: (p) => expect(p.getByRole('complementary', { name: 'Properties' })).toBeVisible() },
  { name: 'members', url: '/w/demo/members', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'workspace settings', url: '/w/demo/settings', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'search', url: '/search?q=cron', ready: (p) => expect(p.getByRole('list', { name: /results/i })).toBeVisible() },
];

for (const c of PAGES) {
  test(`no CSP violations or console errors on ${c.name}`, async ({ page }) => {
    const bad = watch(page);
    await page.goto(c.url);
    await c.ready(page);
    await page.waitForTimeout(500);
    expect(bad, bad.join('\n')).toEqual([]);
  });
}

test('board view and loading skeleton are CSP clean', async ({ page }) => {
  const bad = watch(page);
  await page.goto('/');
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.locator('section.col').first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(bad, bad.join('\n')).toEqual([]);
});

test('server-rendered HTML carries no style attributes (strict style-src)', async ({ request }) => {
  for (const url of ['/', '/w/demo/issue/DEM-1', '/w/demo/members', '/w/demo/settings']) {
    const html = await (await request.get(url)).text();
    expect(html.match(/<[a-z0-9]+[^>]*\sstyle="/g) ?? [], url).toEqual([]);
  }
});

test('team role is a ui Select (not a native select) and changes the role', async ({ page }) => {
  await page.goto('/w/demo/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const btn = page.getByRole('button', { name: /^Team role for / }).first();
  await expect(btn).toBeVisible();
  expect(await page.locator('select.set-select').count()).toBe(0);
  const before = (await btn.getAttribute('aria-label')) ?? '';
  await btn.click();
  const menu = page.getByRole('menu', { name: /Team role for/ });
  await expect(menu).toBeVisible();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveCount(3);
  // Escape closes without changing anything.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await btn.getAttribute('aria-label')).toBe(before);
  // Pick a different role: the button label must change; then restore it.
  const cur = before.split(': ').pop() ?? '';
  await btn.click();
  const other = items.filter({ hasNotText: new RegExp(cur, 'i') }).first();
  const otherName = (await other.innerText()).replace(/[^A-Za-z ]/g, '').trim();
  await other.click();
  await expect(btn).toHaveAttribute('aria-label', new RegExp(`: ${otherName}$`));
  await btn.click();
  await page.getByRole('menuitem', { name: new RegExp(cur, 'i') }).first().click();
  await expect(btn).toHaveAttribute('aria-label', before);
});

test('invite role is a radiogroup', async ({ page }) => {
  await page.goto('/w/demo/members');
  await page.getByRole('button', { name: /invite/i }).first().click();
  const g = page.getByRole('radiogroup', { name: 'Role' });
  await expect(g).toBeVisible();
  await g.getByRole('radio', { name: 'Guest' }).click();
  await expect(g.getByRole('radio', { name: 'Guest' })).toHaveAttribute('aria-checked', 'true');
  await expect(g.getByRole('radio', { name: 'Member' })).toHaveAttribute('aria-checked', 'false');
});

test('invite role radiogroup: roving tabindex and arrow keys', async ({ page }) => {
  await page.goto('/w/demo/members');
  await page.getByRole('button', { name: /invite/i }).first().click();
  const g = page.getByRole('radiogroup', { name: 'Role' });
  const radios = g.getByRole('radio');
  const n = await radios.count();
  const checked = g.locator('[aria-checked="true"]');
  await expect(checked).toHaveAttribute('tabindex', '0');
  expect(await g.locator('[tabindex="-1"]').count()).toBe(n - 1);
  const first = (await checked.innerText()).trim();
  await checked.focus();
  await page.keyboard.press('ArrowRight');
  await expect(g.locator('[aria-checked="true"]')).not.toHaveText(first);
  await expect(g.locator('[aria-checked="true"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(g.locator('[aria-checked="true"]')).toHaveText(first);
});
