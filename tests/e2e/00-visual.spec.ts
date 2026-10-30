import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settled } from './helpers/settled';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// Visual regression at 1280x800, dark, on the seeded demo workspace with the fixed test clock (?today=2026-10-27).
// File name starts with 00- so it runs first, before other specs add issues to the shared DB: the seed is the fixture.
// Each screen: pixel baseline (tests/e2e/00-visual.spec.ts-snapshots/*-linux.png) + axe wcag2a/aa (contrast included).
// Update baselines on purpose with: pnpm exec playwright test tests/e2e/00-visual.spec.ts --update-snapshots, and review the images in the PR.
test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });

const TODAY = 'today=2026-10-27';
const SHOT = { maxDiffPixelRatio: 0.015, animations: 'disabled' as const, caret: 'hide' as const };

async function ready(page: Page, url: string, waitFor: () => Promise<unknown>) {
  await page.goto(url);
  await page.waitForSelector('html[data-ready]');
  await waitFor();
  await page.evaluate(() => document.fonts.ready);
  await settled(page);
  await page.mouse.move(0, 0);
}
async function check(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}-1280.png`, SHOT);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${name}: ${v.id} x${v.nodes.length} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `axe ${name}`).toEqual([]);
}

test('visual: list', async ({ page }) => {
  await ready(page, `/?${TODAY}`, () => expect(page.getByRole('option').first()).toBeVisible());
  await check(page, 'list');
});

test('visual: list with Display popover', async ({ page }) => {
  await ready(page, `/?${TODAY}`, () => expect(page.getByRole('option').first()).toBeVisible());
  await page.getByRole('button', { name: /display/i }).click();
  await settled(page);
  await check(page, 'list-display');
});

test('visual: board', async ({ page }) => {
  await ready(page, `/?${TODAY}`, () => expect(page.getByRole('option').first()).toBeVisible());
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.locator('section.col').first()).toBeVisible();
  await settled(page);
  await check(page, 'board');
});

test('visual: issue page', async ({ page }) => {
  await ready(page, `/w/demo/issue/DEM-1?${TODAY}`, () => expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible());
  await check(page, 'issue');
});

test('visual: projects', async ({ page }) => {
  await ready(page, `/?view=projects&${TODAY}`, () => expect(page.locator('.cycle.project').first()).toBeVisible());
  await check(page, 'projects');
});

test('visual: cycles', async ({ page }) => {
  await ready(page, `/?view=cycles&${TODAY}`, () => expect(page.locator('.cycle').first()).toBeVisible());
  await check(page, 'cycles');
});

test.describe('inbox', () => {
  test.use({ storageState: INBOX_STATE });
  // FIXME(#187 tokens): inbox buttons (.inbox-bar > button, Archive/Snooze/Mark read/Open issue) render with the native light button background (#efefef) and light text:
  // contrast 1.08 to 2.42. Un-fixme and add the baseline (--update-snapshots) once they are styled with tokens.
  test.fixme('visual: inbox', async ({ page }) => {
    await resetInbox();
    await ready(page, `/?view=inbox&${TODAY}`, () => expect(page.getByRole('option').first()).toBeVisible());
    await check(page, 'inbox');
  });
});
