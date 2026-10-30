import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
});

const count = async (page: Page) => Number(await page.locator('.crumbs .count').textContent());
const modal = (page: Page) => page.getByRole('dialog', { name: 'New issue' });

test('C opens the modal without creating anything; the title is focused', async ({ page }) => {
  const n0 = await count(page);
  await page.keyboard.press('c');
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).getByRole('textbox', { name: 'Issue title' })).toBeFocused();
  expect(await count(page)).toBe(n0);
});

test('the New issue button opens the same modal; Esc closes it and creates nothing', async ({ page }) => {
  const n0 = await count(page);
  await page.getByRole('button', { name: /^New issue/ }).click();
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeHidden();
  expect(await count(page)).toBe(n0);
});

test('an empty title does not create: Cmd+Enter flags it and keeps the modal open', async ({ page }) => {
  const n0 = await count(page);
  await page.keyboard.press('c');
  await page.keyboard.press('Control+Enter');
  await expect(modal(page).getByRole('alert')).toHaveText('A title is required.');
  await expect(modal(page)).toBeVisible();
  expect(await count(page)).toBe(n0);
});

test('Tab stays inside the modal (focus trap) and focus returns to the opener on close', async ({ page }) => {
  const btn = page.getByRole('button', { name: /^New issue/ });
  await btn.focus();
  await page.keyboard.press('Enter');
  await expect(modal(page)).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog][aria-label],[role=dialog][aria-labelledby]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(btn).toBeFocused();
});

test('creates with description and properties from the pickers; the issue is selected with those values', async ({ page }) => {
  const n0 = await count(page);
  await page.keyboard.press('c');
  const d = modal(page);
  await d.getByRole('textbox', { name: 'Issue title' }).fill('Modal full issue');
  await d.getByRole('textbox', { name: 'Description' }).click();
  await page.keyboard.type('Body text from the modal');
  await d.getByRole('button', { name: 'Todo' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^In Progress$/i }).click();
  await d.getByRole('button', { name: 'No priority' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^Urgent$/ }).click();
  await d.getByRole('button', { name: 'Labels' }).click();
  await page.locator('.combo-opt').filter({ hasText: /Bug$/ }).click();
  await page.keyboard.press('Escape'); // closes the picker only
  await expect(d).toBeVisible();
  await expect(d.getByText('Bug', { exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Project' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^Mini Linear$/ }).click();
  await d.getByRole('button', { name: 'Assignee' }).click();
  await page.locator('.combo-opt').nth(1).click();
  await d.getByRole('button', { name: 'Create issue' }).click();
  await expect(d).toBeHidden();
  expect(await count(page)).toBe(n0 + 1);
  const row = page.getByRole('option', { name: /Modal full issue/ }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.pi-urgent')).toHaveCount(1);
  await expect(row.getByText('Bug', { exact: true })).toBeVisible();
  await page.reload(); // persisted through the API, not just the local store
  const again = page.getByRole('option', { name: /Modal full issue/ }).first();
  await expect(again.locator('.pi-urgent')).toHaveCount(1);
  await expect(again.getByText('Bug', { exact: true })).toBeVisible();
});

test('Create more keeps the modal open, clears the title, keeps the properties', async ({ page }) => {
  const n0 = await count(page);
  await page.keyboard.press('c');
  const d = modal(page);
  await d.getByRole('button', { name: 'No priority' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^High$/ }).click();
  await d.getByRole('switch', { name: 'Create more' }).check();
  const title = d.getByRole('textbox', { name: 'Issue title' });
  await title.fill('More one');
  await page.keyboard.press('Control+Enter');
  await expect(title).toHaveValue('');
  await expect(title).toBeFocused();
  await expect(d.getByRole('button', { name: 'High' })).toBeVisible();
  await title.fill('More two');
  await page.keyboard.press('Control+Enter');
  await expect(title).toHaveValue('');
  await expect.poll(() => count(page)).toBe(n0 + 2);
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});

test('global shortcuts are inert behind the modal', async ({ page }) => {
  await page.keyboard.press('c');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search commands' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Labels' }).focus();
  await page.keyboard.press('g'); await page.keyboard.press('v');
  await expect(page.locator('.board')).toBeHidden();
});

test('the board column + button opens the modal preset to that status', async ({ page }) => {
  await page.getByRole('button', { name: /board/i }).click();
  await page.getByRole('button', { name: 'Add issue to Done' }).click();
  await expect(modal(page).getByRole('button', { name: 'Done' })).toBeVisible();
  await modal(page).getByRole('textbox', { name: 'Issue title' }).fill('Preset done');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('[data-testid=col-done]').getByText('Preset done').first()).toBeVisible();
});

test('the list group header + shows on hover and opens the modal preset to that status', async ({ page }) => {
  const head = page.locator('section.group h2').filter({ hasText: 'Backlog' }).first();
  const add = head.getByRole('button', { name: 'Add issue to Backlog' });
  await expect(add).toHaveCSS('opacity', '0');
  await head.hover();
  await expect(add).toHaveCSS('opacity', '1');
  await add.click();
  await expect(modal(page).getByRole('button', { name: 'Backlog' })).toBeVisible();
});

test('board column header: hover reveals + and ···; Hide column removes it and Show restores it', async ({ page }) => {
  await page.getByRole('button', { name: /board/i }).click();
  const col = page.locator('section.col', { has: page.locator('#c-backlog') });
  await col.locator('.col-head').hover();
  await expect(col.getByRole('button', { name: 'Add issue to Backlog' })).toHaveCSS('opacity', '1');
  await expect(col.getByRole('button', { name: 'Backlog column options' })).toHaveCSS('opacity', '1');
  await col.getByRole('button', { name: 'Backlog column options' }).click();
  await page.getByRole('menuitem', { name: 'Hide column' }).click();
  await expect(page.locator('#c-backlog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Backlog column' }).click();
  await expect(page.locator('#c-backlog')).toHaveCount(1);
});

test('board scrolls horizontally with right padding after the last column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /board/i }).click();
  const b = page.locator('.board');
  await b.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const gap = await page.evaluate(() => {
    const board = document.querySelector('.board')!; const cols = board.querySelectorAll('section.col');
    return board.getBoundingClientRect().right - cols[cols.length - 1]!.getBoundingClientRect().right;
  });
  expect(gap).toBeGreaterThanOrEqual(12);
});

test('reduced motion: the modal appears and disappears without a lingering node', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('c');
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ni-scrim')).toHaveCount(0);
});

test('axe: the open modal has no WCAG A/AA violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('c');
  await expect(modal(page)).toBeVisible();
  const r = await new AxeBuilder({ page }).include('.ni').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
});

test('formatting bar: hidden until a selection, then floats over the editor without moving the layout', async ({ page }) => {
  await page.keyboard.press('c');
  const m = modal(page);
  await expect(m).toBeVisible();
  const bar = m.getByRole('toolbar', { name: 'Description formatting' });
  await expect(bar).toHaveCount(0);
  const ed = m.getByRole('textbox', { name: 'Description' });
  await ed.click();
  await page.keyboard.type('hello world');
  const h0 = (await m.boundingBox())?.height;
  const y0 = (await m.locator('.ni-props').boundingBox())?.y;
  await page.keyboard.press('Control+a');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-floating', 'true');
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
  expect((await m.boundingBox())?.height).toBe(h0);
  expect((await m.locator('.ni-props').boundingBox())?.y).toBe(y0);
  await page.keyboard.press('ArrowRight');
  await expect(bar).toHaveCount(0);
});

test('a lone slash in the description opens the bar and stays in the text', async ({ page }) => {
  await page.keyboard.press('c');
  const m = modal(page);
  const ed = m.getByRole('textbox', { name: 'Description' });
  await ed.click();
  await page.keyboard.type('/');
  await expect(m.getByRole('toolbar', { name: 'Description formatting' })).toBeVisible();
  await expect(ed).toHaveText('/');
  await page.keyboard.type('x');
  await expect(m.getByRole('toolbar', { name: 'Description formatting' })).toHaveCount(0);
  await expect(ed).toHaveText('/x');
});
