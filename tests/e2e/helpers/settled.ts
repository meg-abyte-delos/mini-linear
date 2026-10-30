import type { Page } from '@playwright/test';

// Wait until every finite CSS animation/transition on the page has finished (e.g. the palette's 140ms pal-in fade).
// Infinite animations (skeletons) and scroll-driven ones (board edge fades: their timeline is a ScrollTimeline, .finished never resolves) are ignored. Call before an axe scan so contrast is computed on final colours.
export async function settled(page: Page) {
  await page.evaluate(async () => {
    const finite = () => document.getAnimations().filter((a) => a.timeline === document.timeline && a.effect?.getTiming().iterations !== Infinity);
    for (let i = 0; i < 10 && finite().length; i++) await Promise.allSettled(finite().map((a) => a.finished));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}
