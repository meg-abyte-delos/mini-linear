import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settled } from './helpers/settled';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// Contrast gate (WCAG 2 AA, 4.5:1 for normal text, 3:1 for large text per axe): fails the build on ANY color-contrast violation
// on every screen listed below. The app ships one theme (dark; colorScheme does not change it), so there is no light pass. Dedicated rule so a failure names the screen, the ratio and the node.
// When a new screen ships, add it to SCREENS in the same PR: a screen not listed here is not gated.
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

const TODAY = 'today=2026-10-27';
type Screen = { name: string; url: string; ready: (p: Page) => Promise<unknown>; anon?: boolean; known?: string; bare?: boolean; inbox?: boolean; act?: (p: Page) => Promise<unknown> };
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

for (const scheme of ['dark'] as const) {
  for (const s of SCREENS) {
    test.describe(`${scheme}`, () => {
      test.use({ colorScheme: scheme, ...(s.anon ? { storageState: { cookies: [], origins: [] } } : {}), ...(s.inbox ? { storageState: INBOX_STATE } : {}) });
      test(`contrast AA: ${s.name} (${scheme})`, async ({ page }) => {
        // Known real defect: test.fail keeps CI green but flips RED the day it is fixed, so the entry (and this line) gets removed with the fix.
        if (s.known) test.fail(true, s.known);
        if (s.inbox) await resetInbox();
        await page.goto(s.url);
        if (!s.anon && !s.bare) await page.waitForSelector('html[data-ready]');
        await s.ready(page);
        if (s.act) await s.act(page);
        await page.evaluate(() => document.fonts.ready);
        await settled(page);
        await page.mouse.move(0, 0);
        const r = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        const fails = r.violations.flatMap((v) => v.nodes.map((n) => {
          const d = (n.any[0]?.data ?? {}) as { contrastRatio?: number; fgColor?: string; bgColor?: string; expectedContrastRatio?: string };
          return `${s.name}/${scheme}: ${d.contrastRatio} < ${d.expectedContrastRatio} fg ${d.fgColor} bg ${d.bgColor} @ ${n.target.join(' ')}`;
        }));
        expect(fails, `color-contrast on ${s.name} (${scheme})`).toEqual([]);
      });
    });
  }
}
