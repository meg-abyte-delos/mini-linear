import { test, expect, type Page } from '@playwright/test';

// Rex on #386: at 768 the Filter/Display labels collapse (visually hidden) and the icon is all that is left.
// A clipped label took the icon with it. Spec: the toolbar buttons stay usable, so the icon must be rendered, inside the button and not clipped.
test.use({ viewport: { width: 768, height: 800 } });

const home = async (page: Page, qs = '') => {
  await page.goto(`/${qs}`);
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
};

for (const view of ['list', 'board'] as const) {
  for (const id of ['fb-add', 'fb-display']) {
    test(`768 ${view}: #${id} icon is visible and not clipped`, async ({ page }) => {
      await home(page, view === 'board' ? '?view=board' : '');
      const btn = page.locator(`#${id}`);
      await expect(btn).toBeVisible();
      const icon = btn.locator('svg').first();
      await expect(icon).toBeVisible();
      const [b, i] = await Promise.all([btn.boundingBox(), icon.boundingBox()]);
      expect(b && i).toBeTruthy();
      // the icon keeps its size and sits fully inside the button box (a collapsed or clipped button hides it)
      expect(i!.width).toBeGreaterThanOrEqual(10);
      expect(i!.height).toBeGreaterThanOrEqual(10);
      expect(i!.x).toBeGreaterThanOrEqual(b!.x - 0.5);
      expect(i!.x + i!.width).toBeLessThanOrEqual(b!.x + b!.width + 0.5);
      expect(i!.y).toBeGreaterThanOrEqual(b!.y - 0.5);
      expect(i!.y + i!.height).toBeLessThanOrEqual(b!.y + b!.height + 0.5);
      // and it is the element hit at its centre (not covered or clipped by an ancestor)
      const hit = await icon.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && t.closest('button') === el.closest('button'); });
      expect(hit).toBe(true);
    });
  }
}
