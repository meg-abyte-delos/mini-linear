import { test, expect, type Locator, type Page } from '@playwright/test';
import { settled } from './helpers/settled';

// Visual baselines 1280x800 dark for screens outside the app shell: login, signup, search.
// Axe/contrast for these screens is covered by contrast-gate.spec.ts. Update on purpose with --update-snapshots and review the images in the PR.
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
const SHOT = { maxDiffPixelRatio: 0.002, animations: 'disabled' as const, caret: 'hide' as const };

async function shot(page: Page, name: string, mask: Locator[] = []) {
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(`${name}-1280.png`, { ...SHOT, mask });
}

test.describe('anonymous', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('visual: login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();
    await shot(page, 'login');
  });
  test('visual: signup', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('form')).toBeVisible();
    await shot(page, 'signup');
  });
});

test('visual: search results', async ({ page }) => {
  // The sidebar Inbox badge depends on the mode (mock client seeds unread rows, API mode polls the real inbox every 30s): mask it so the shot is mode-independent.
  await page.goto('/search?q=cron&today=2026-10-27');
  const first = page.getByRole('list', { name: /results/i }).getByRole('listitem').first();
  await expect(first).toBeVisible();
  await expect(first).toContainText(/cron/i); // real result, not an empty state or an unrelated first hit
  await shot(page, 'search', [page.getByTestId('inbox-badge')]);
});
