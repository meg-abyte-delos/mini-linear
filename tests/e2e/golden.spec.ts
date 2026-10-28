import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Golden flows: the journeys a Linear user does every day.
// Flows whose feature has not landed on main yet are test.fixme with the reason,
// so they show as pending in the report instead of silently missing.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
});

const issueCount = async (page: import('@playwright/test').Page) => Number(await page.locator('.crumbs .count').textContent());

test('golden: create an issue from the sidebar, the C shortcut and the palette', async ({ page }) => {
  const n0 = await issueCount(page);
  await page.getByRole('button', { name: /^New issue/ }).click();
  await expect.poll(() => issueCount(page)).toBe(n0 + 1);
  await expect(page.getByRole('option', { name: /New issue/ }).first()).toBeVisible();
  await page.locator('h1.crumb-title').click();
  await page.keyboard.press('c');
  await expect.poll(() => issueCount(page)).toBe(n0 + 2);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('create issue');
  await page.keyboard.press('Enter');
  await expect.poll(() => issueCount(page)).toBe(n0 + 3);
});

test('golden: create from the cycles view lands back on the list with the new issue', async ({ page }) => {
  await page.getByRole('link', { name: 'Cycles' }).click();
  await expect(page.locator('h1.crumb-title')).toHaveText('Cycles');
  await page.getByRole('button', { name: /^New issue/ }).click();
  await expect(page.locator('h1.crumb-title')).toHaveText('Issues');
  await expect(page.getByRole('option', { name: /New issue/ }).first()).toBeVisible();
});

test('golden: board drag and drop moves a card and the column counts follow', async ({ page }) => {
  await page.getByRole('button', { name: /board/i }).click();
  const cols = page.locator('section.col');
  const n = async (i: number) => Number(await cols.nth(i).locator('h2 .count').textContent());
  const a0 = await n(0);
  const b0 = await n(1);
  test.skip(a0 === 0, 'first column empty in this fixture');
  const target = cols.nth(1).locator('h2');
  await target.scrollIntoViewIfNeeded();
  await cols.first().getByRole('option').first().dragTo(target);
  await expect.poll(() => n(0)).toBe(a0 - 1);
  await expect.poll(() => n(1)).toBe(b0 + 1);
});

test('golden: cycles view shows progress and drills into a cycle filter', async ({ page }) => {
  await page.getByRole('link', { name: 'Cycles' }).click();
  await expect(page).toHaveURL(/view=cycles/);
  const cycle = page.locator('.cycle').first();
  await expect(cycle.getByRole('img', { name: /% complete/ })).toBeVisible();
  await cycle.getByRole('button', { name: 'View issues' }).click();
  await expect(page.locator('h1.crumb-title')).toHaveText('Issues');
  await expect(page.locator('#fb-cycle')).toHaveAttribute('aria-pressed', 'true');
});

test('golden: palette search finds an issue by title', async ({ page }) => {
  const title = (await page.getByRole('option').nth(1).locator('.title').textContent())!.trim();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(title.slice(0, 12));
  await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first()).toBeVisible();
});

test('golden: full-text search page returns ranked issues', async ({ page }) => {
  await page.goto('/search?q=cron');
  await expect(page.getByRole('list', { name: /results/i }).getByRole('listitem').first()).toBeVisible();
});

// Inbox (area 7) is built in parallel: the sidebar Inbox link is still a placeholder.
test.fixme('golden: inbox lists notifications and marks one read', async ({ page }) => {
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL(/inbox/);
  const item = page.getByRole('listitem').first();
  await item.getByRole('button', { name: /mark (as )?read/i }).click();
  await expect(item).toHaveAttribute('data-read', 'true');
});

const wcag = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

test('a11y: cycles and projects views have no wcag2a/aa violations', async ({ page }) => {
  for (const v of ['cycles', 'projects']) {
    await page.goto(`/?view=${v}`);
    await page.waitForSelector('html[data-ready]');
    const r = await wcag(page);
    expect(r.violations.map((x) => `${v}: ${x.id} x${x.nodes.length}`)).toEqual([]);
  }
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('group', { name: 'Projects display' }).getByRole('button', { name: 'Roadmap' }).click();
  const r = await wcag(page);
  expect(r.violations.map((x) => `roadmap: ${x.id} x${x.nodes.length}`)).toEqual([]);
});

test('a11y: detail panel and filter picker have no wcag2a/aa violations', async ({ page }) => {
  await page.getByRole('option').first().click();
  await expect(page.getByRole('complementary', { name: 'Issue detail' })).toBeVisible();
  let r = await wcag(page);
  expect(r.violations.map((x) => `panel: ${x.id} x${x.nodes.length}`)).toEqual([]);
  await page.getByRole('button', { name: 'Close detail panel' }).click();
  await page.locator('#fb-status').click();
  r = await wcag(page);
  expect(r.violations.map((x) => `filter: ${x.id} x${x.nodes.length}`)).toEqual([]);
});
