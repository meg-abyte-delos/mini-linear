import { test, expect, type Page } from '@playwright/test';
import { settled } from './helpers/settled';

// Visual baseline 1280x800 dark: team-settings. Axe/contrast is covered by contrast-gate.spec.ts and settings-members-d6.spec.ts.
// Update on purpose with --update-snapshots and review the image in the PR.
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });

test('visual: team-settings', async ({ page }) => {
  const teams = (await (await page.request.get('/api/v1/w/demo/teams?limit=100')).json()) as { items: { id: string; key?: string }[] };
  expect(teams.items.length).toBeGreaterThan(0);
  await page.goto('/settings/teams/' + teams.items[0]!.id + '?w=demo');
  await expect(page.getByRole('button', { name: 'Add state' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('team-settings-1280.png', { maxDiffPixelRatio: 0.015, animations: 'disabled', caret: 'hide' });
});
