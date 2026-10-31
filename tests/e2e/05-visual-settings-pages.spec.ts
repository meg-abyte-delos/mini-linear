import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settled } from './helpers/settled';

// Visual baselines 1280x800 dark for the per-entry settings pages, plus axe wcag2a/2aa (incl. color-contrast 4.5) in dark and light.
// Labels joins the table when its page lands. Update on purpose with --update-snapshots and review the images in the PR.
const PAGES = [
  { name: 'profile', h1: 'Profile' },
  { name: 'preferences', h1: 'Preferences' },
  { name: 'notifications', h1: 'Notifications' },
  { name: 'teams', h1: 'Teams' },
] as const;

for (const p of PAGES) {
  test.describe(`settings page: ${p.name}`, () => {
    test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

    test(`visual: settings-${p.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto(`/w/demo/settings/${p.name}`);
      await expect(page.getByRole('heading', { name: p.h1, level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await settled(page);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`settings-${p.name}-1280.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
    });

    for (const scheme of ['dark', 'light'] as const) {
      test(`axe AA: settings-${p.name} (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`/w/demo/settings/${p.name}`);
        await expect(page.getByRole('heading', { name: p.h1, level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await settled(page);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(r.violations.map((v) => `${v.id} x${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(1);
      });
    }
  });
}
