import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue } from './helpers/auth';

// Layout acceptance on the issue page (/w/:slug/issue/:id), from Pierre's report: opening an issue must not lose the left sidebar,
// and the Properties panel on the right must stay usable (not squeezed).
// PROVISIONAL: Iris has no Linear measurements yet. 300px is the current code value (--idp-side-w), not a Linear measure.
// Change the constants (or PROPS_MIN_W_* env) when she has real numbers, not the assertions.
const PROPS_MIN_W: Record<number, number> = { 1280: Number(process.env.PROPS_MIN_W_1280 ?? 300), 1440: Number(process.env.PROPS_MIN_W_1440 ?? 300) };
const SIDEBAR_MIN_W = Number(process.env.SIDEBAR_MIN_W ?? 0);
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

for (const width of [1280, 1440]) {
  test.describe(`viewport ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('sidebar stays visible on the issue page and navigates back', async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-sidebar-${width}-${Date.now()}`);
      await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
      await page.waitForSelector('html[data-ready]');
      const side = page.getByRole('complementary', { name: 'Sidebar' });
      await expect(side).toBeVisible();
      const box = (await side.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(SIDEBAR_MIN_W);
      expect(box.x).toBeLessThanOrEqual(1);
      await expect(side.getByRole('link', { name: /inbox/i })).toBeVisible();
    });

    test('sidebar on the issue page has the same width as on the list', async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-same-${width}-${Date.now()}`);
      await page.goto('/');
      await page.waitForSelector('html[data-ready]');
      const list = (await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox())!;
      await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
      await page.waitForSelector('html[data-ready]');
      const on = (await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox())!;
      expect(on.width).toBe(list.width);
    });

    test('sidebar persists when opening an issue from the list', async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-open-${width}-${Date.now()}`);
      await page.goto('/');
      await page.waitForSelector('html[data-ready]');
      const side = page.getByRole('complementary', { name: 'Sidebar' });
      await expect(side).toBeVisible();
      await page.getByRole('option').filter({ hasText: issue.identifier }).first().click();
      await page.getByRole('option').filter({ hasText: issue.identifier }).first().dblclick().catch(() => {});
      await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
      await expect(side).toBeVisible();
    });

    test(`Properties panel is at least ${PROPS_MIN_W[width]}px wide, fully inside the viewport`, async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-props-${width}-${Date.now()}`);
      await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
      await page.waitForSelector('html[data-ready]');
      const props = page.getByRole('complementary', { name: 'Properties' });
      await expect(props).toBeVisible();
      const box = (await props.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(PROPS_MIN_W[width]!);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      // The main column keeps a readable measure next to it.
      const main = (await page.locator('.idp-main').boundingBox())!;
      expect(main.width).toBeGreaterThanOrEqual(480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
