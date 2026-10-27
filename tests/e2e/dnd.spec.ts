import { test, expect, type Page } from '@playwright/test';

const statusOf = (page: Page, id: string) =>
  page.locator(`[data-id="${id}"]`).evaluate((el) => el.closest('section')?.querySelector('h2 span:nth-child(2)')?.textContent);

test('dnd list: dropping a row on another group changes its status', async ({ page }) => {
  await page.goto('/');
  const src = page.getByRole('option').first();
  const id = (await src.getAttribute('data-id'))!;
  const from = await statusOf(page, id);
  const target = page.locator('section.group').last();
  await src.dragTo(target.locator('h2'));
  const to = await statusOf(page, id);
  expect(to).not.toBe(from);
  expect(await target.locator('h2 span').nth(0).textContent()).toBe(to);
});

test('dnd board: dropping a card on another column changes its status', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /board/i }).click();
  const src = page.getByRole('option').first();
  const id = (await src.getAttribute('data-id'))!;
  const from = await statusOf(page, id);
  const h = page.locator('section.col').nth(1).locator('h2');
  await h.scrollIntoViewIfNeeded();
  await src.dragTo(h);
  expect(await statusOf(page, id)).not.toBe(from);
});
