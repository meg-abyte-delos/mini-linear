import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue } from './helpers/auth';

// Layout acceptance on the issue page (/w/:slug/issue/:id), from Pierre's report: opening an issue must not lose the left sidebar,
// and the Properties panel on the right must stay usable (not squeezed).
// Properties rail contract = the layout token in tokens.css: --idp-side-w = clamp(--idp-side-min, 24vw, 340px), --idp-side-min = 280px.
// The floor and the clamp come from the token (public Linear values, to be re-measured by Iris), not from whatever the code renders today.
const PROPS_FLOOR = 280;
const PROPS_CEIL = 340;
const propsWidth = (vw: number) => Math.min(PROPS_CEIL, Math.max(PROPS_FLOOR, vw * 0.24));
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

    test('issue page and Search show the same sidebar entries as the list', async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-entries-${width}-${Date.now()}`);
      const labels = async (url: string) => {
        await page.goto(url);
        const side = page.getByRole('complementary', { name: 'Sidebar' });
        await expect(side.getByRole('link', { name: 'My issues', exact: true })).toBeVisible();
        await expect(side.getByRole('link', { name: 'Views', exact: true })).toBeVisible();
        await expect(side.getByRole('group', { name: 'Saved views' })).toBeAttached();
        await expect(side.getByRole('link', { name: 'Issues' }).first()).toBeVisible();
        await expect(side.getByRole('link', { name: 'Cycles' }).first()).toBeVisible();
        await expect(side.getByRole('link', { name: 'Projects' }).first()).toBeVisible();
        await expect(side.getByRole('group', { name: 'Saved views' })).toBeAttached();
        await page.waitForTimeout(500); // people/teams/unread load async
        return (await side.locator('.side-link').allInnerTexts()).map((t) => t.replace(/\s*\d+\+?$/, ''));
      };
      const list = await labels('/');
      expect(await labels(`/w/${DEMO.slug}/issue/${issue.identifier}`)).toEqual(list);
      expect(await labels('/search')).toEqual(list);
    });

    test('sidebar marks the current route: Issues on the issue page, Search icon on /search', async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-active-${width}-${Date.now()}`);
      await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
      const side = page.getByRole('complementary', { name: 'Sidebar' });
      await expect(side.locator('a.side-link[aria-current="page"]').first()).toHaveText(/Issues/);
      // At most one Issues link is marked (the issue's own team), never one per team.
      await expect(side.locator('a.side-link[aria-current="page"]')).toHaveCount(1);
      await page.goto('/search');
      await expect(side.getByRole('link', { name: 'Search', exact: true })).toHaveAttribute('aria-current', 'page');
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
      // Row click opens the issue page (#351); no dblclick fallback, it would wait out the test on a detached row.
      await page.getByRole('option').filter({ hasText: issue.identifier }).first().click();
      await page.waitForURL(new RegExp(`/issue/${issue.identifier}`));
      await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
      await expect(side).toBeVisible();
    });

    test(`Properties panel follows clamp(${PROPS_FLOOR}px, 24vw, ${PROPS_CEIL}px), never under the ${PROPS_FLOOR}px floor, fully inside the viewport`, async ({ page }) => {
      const issue = await apiCreateIssue(page, `layout-props-${width}-${Date.now()}`);
      await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
      await page.waitForSelector('html[data-ready]');
      const props = page.getByRole('complementary', { name: 'Properties' });
      await expect(props).toBeVisible();
      const box = (await props.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(PROPS_FLOOR);
      expect(Math.abs(box.width - propsWidth(width))).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--idp-side-min').trim())).toBe(`${PROPS_FLOOR}px`);
      // Drawer toggle only exists below 1024px.
      await expect(page.getByRole('button', { name: 'Properties', exact: true })).toBeHidden();
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      // The main column keeps a readable measure next to it.
      const main = (await page.locator('.idp-main').boundingBox())!;
      expect(main.width).toBeGreaterThanOrEqual(480);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}


// Below 1024px the Properties rail is a right drawer opened from the header button.
test.describe('Properties drawer under 1024px', () => {
  test.use({ viewport: { width: 900, height: 800 } });

  async function open(page: import('@playwright/test').Page, tag: string) {
    const issue = await apiCreateIssue(page, `layout-drawer-${tag}-${Date.now()}`);
    await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
    await page.waitForSelector('html[data-ready]');
    const toggle = page.getByRole('button', { name: 'Properties', exact: true });
    // The panel is role=complementary when closed and role=dialog (aria-modal) while the drawer is open (#349, Iris).
    const aside = page.locator('#idp-props');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(aside).toBeHidden();
    await toggle.click();
    await expect(aside).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Properties' })).toBeVisible();
    await expect(aside).toHaveAttribute('aria-modal', 'true');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    return { toggle, aside };
  }
  const focusInside = (aside: import('@playwright/test').Locator) => aside.evaluate((el) => el.contains(document.activeElement));

  test('opening moves focus inside the drawer', async ({ page }) => {
    const { aside } = await open(page, 'focus');
    await expect.poll(() => focusInside(aside)).toBe(true);
    // The drawer slides in: wait for the transition to end before measuring.
    await expect.poll(async () => { const b = (await aside.boundingBox())!; return b.x + b.width; }).toBeLessThanOrEqual(900 + 1);
    expect((await aside.boundingBox())!.width).toBeGreaterThanOrEqual(PROPS_FLOOR);
  });

  test('Esc closes the drawer and returns focus to the Properties button', async ({ page }) => {
    const { toggle, aside } = await open(page, 'esc');
    await expect.poll(() => focusInside(aside)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(aside).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('the Close button closes the drawer and returns focus to the Properties button', async ({ page }) => {
    const { toggle, aside } = await open(page, 'close');
    await page.getByRole('button', { name: 'Close properties' }).click();
    await expect(aside).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });

  test('clicking the scrim closes the drawer and returns focus to the Properties button', async ({ page }) => {
    const { toggle, aside } = await open(page, 'scrim');
    await page.mouse.click(40, 400); // left of the drawer (x >= 620)
    await expect(aside).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
});

test('issue page: Status menu opens on the left edge of its trigger (not shifted left by viewport clamping)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const issue = await apiCreateIssue(page, `layout-status-menu-${Date.now()}`);
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const trigger = page.locator('.idp-side dd button').first();
  await trigger.click();
  const pop = page.getByRole('dialog', { name: /status/i });
  await expect(pop).toBeVisible();
  const t = (await trigger.boundingBox())!;
  const p = (await pop.boundingBox())!;
  expect(Math.abs(p.x - t.x)).toBeLessThanOrEqual(2);
});
