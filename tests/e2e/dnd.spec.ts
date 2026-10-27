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

test('palette "Move to" is a keyboard alternative to dragging (WCAG 2.5.7)', async ({ page }) => {
  await page.goto('/');
  const id = (await page.getByRole('option').first().getAttribute('data-id'))!;
  const from = await statusOf(page, id);
  await page.keyboard.press('Control+k');
  const target = from === 'Done' ? 'Todo' : 'Done';
  await page.getByRole('combobox', { name: 'Search commands' }).fill(`move to ${target}`);
  await page.keyboard.press('Enter');
  expect(await statusOf(page, id)).toBe(target);
});

test('dnd board: dropping on the last column (scrolled into view)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /board/i }).click();
  const src = page.getByRole('option').first();
  const id = (await src.getAttribute('data-id'))!;
  const h = page.locator('section.col').last().locator('h2');
  const sb = (await src.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + 10, sb.y + 20, { steps: 3 });
  // Scroll the last column into view while the drag is in flight (as auto-scroll would).
  await h.scrollIntoViewIfNeeded();
  const hb = (await h.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await statusOf(page, id)).toBe(await h.locator('span').nth(0).textContent());
});

test('Alt+ArrowDown / Alt+ArrowUp reorders within a column (WCAG 2.5.7)', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const opts = page.getByRole('option');
  const a = (await opts.nth(0).getAttribute('data-id'))!;
  const b = (await opts.nth(1).getAttribute('data-id'))!;
  await opts.first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(opts.nth(1)).toHaveAttribute('data-id', a);
  await expect(opts.nth(0)).toHaveAttribute('data-id', b);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(opts.nth(0)).toHaveAttribute('data-id', a);
});
