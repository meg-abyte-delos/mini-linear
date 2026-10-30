import { test, expect, type Page } from '@playwright/test';
import { settled } from './helpers/settled';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// Console gate: on every screen, 0 uncaught page errors, 0 CSP violations and 0 console errors (React minified errors included, e.g. #441).
// Known defects are listed in KNOWN with a test.fail: CI stays green, flips RED the day the defect is fixed, and the entry gets removed with the fix.
// When a new screen ships, add it to SCREENS in the same PR.
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'dark' });

const TODAY = 'today=2026-10-27';
type Screen = { name: string; url: string; ready: (p: Page) => Promise<unknown>; anon?: boolean; bare?: boolean; inbox?: boolean; act?: (p: Page) => Promise<unknown> };
const SCREENS: Screen[] = [
  { name: 'list', url: `/?${TODAY}`, ready: (p) => expect(p.getByRole('option').first()).toBeVisible() },
  { name: 'list-display-popover', url: `/?${TODAY}`, ready: (p) => expect(p.getByRole('option').first()).toBeVisible(), act: (p) => p.getByRole('button', { name: /display/i }).click() },
  { name: 'palette', url: `/?${TODAY}`, ready: (p) => expect(p.getByRole('option').first()).toBeVisible(), act: async (p) => { await p.keyboard.press('Control+k'); await expect(p.getByRole('combobox')).toBeFocused(); } },
  { name: 'board', url: `/?${TODAY}`, ready: (p) => expect(p.getByRole('option').first()).toBeVisible(), act: async (p) => { await p.getByRole('button', { name: /board/i }).click(); await expect(p.locator('section.col').first()).toBeVisible(); } },
  { name: 'projects', url: `/?view=projects&${TODAY}`, ready: (p) => expect(p.locator('.cycle.project').first()).toBeVisible() },
  { name: 'cycles', url: `/?view=cycles&${TODAY}`, ready: (p) => expect(p.locator('.cycle').first()).toBeVisible() },
  { name: 'inbox', url: `/?view=inbox&${TODAY}`, inbox: true, ready: (p) => expect(p.getByRole('option').first()).toBeVisible() },
  { name: 'issue-page', url: `/w/demo/issue/DEM-1?${TODAY}`, ready: (p) => expect(p.getByRole('complementary', { name: 'Properties' })).toBeVisible() },
  { name: 'search', bare: true, url: '/search?q=cron', ready: (p) => expect(p.getByRole('list', { name: /results/i }).getByRole('listitem').first()).toBeVisible() },
  { name: 'members', bare: true, url: '/w/demo/members', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'workspace-settings', bare: true, url: '/w/demo/settings', ready: (p) => expect(p.getByRole('heading', { level: 1 })).toBeVisible() },
  { name: 'login', url: '/login', anon: true, ready: (p) => expect(p.locator('form')).toBeVisible() },
  { name: 'signup', url: '/signup', anon: true, ready: (p) => expect(p.locator('form')).toBeVisible() },
];


// No known defects tolerated: every console/CSP problem fails the gate.

for (const s of SCREENS) {
  test.describe(`console ${s.name}`, () => {
    test.use({ ...(s.anon ? { storageState: { cookies: [], origins: [] } } : {}), ...(s.inbox ? { storageState: INBOX_STATE } : {}) });
    test(`console clean: ${s.name}`, async ({ page }) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.split('\n')[0]}`));
      page.on('console', (m) => {
        const t = m.text();
        if (/Content Security Policy|Refused to (apply|load|execute|connect)/i.test(t)) problems.push(`csp: ${t.slice(0, 200)}`);
        else if (m.type() === 'error') problems.push(`console.error: ${t.slice(0, 200)}`);
      });
      if (s.inbox) await resetInbox();
      await page.goto(s.url);
      if (!s.anon && !s.bare) await page.waitForSelector('html[data-ready]');
      await s.ready(page);
      if (s.act) await s.act(page);
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      await page.waitForTimeout(500);
      expect(problems, `console problems on ${s.name}`).toEqual([]);
    });
  });
}
