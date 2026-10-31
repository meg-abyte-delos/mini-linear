import { test, expect, type Page } from '@playwright/test';
import { settled } from './helpers/settled';

// Visual baseline 1280x800 dark: members. Axe/contrast is covered by contrast-gate.spec.ts and settings-members-d6.spec.ts.
// Update on purpose with --update-snapshots and review the image in the PR.
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });

test('visual: members', async ({ page }) => {
  await page.goto('/w/demo/members');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('row').nth(1).or(page.getByRole('listitem').first())).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('members-1280.png', { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' });
});
