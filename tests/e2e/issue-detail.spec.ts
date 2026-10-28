import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const URL = '/w/delos/issue/DEL-3?today=2026-10-28';
const ready = async (page: import('@playwright/test').Page) => { await page.goto(URL); await page.waitForSelector('html[data-ready]'); };

test('detail page renders and passes axe (wcag2a/aa)', async ({ page }) => {
  await ready(page);
  await expect(page.getByLabel('Title')).toHaveValue('Board drag and drop');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
  await page.screenshot({ path: 'test-results/issue-detail.png', fullPage: true });
});

test('unknown or malformed identifier is a 404', async ({ page }) => {
  expect((await page.goto('/w/delos/issue/DEL-9999'))?.status()).toBe(404);
  expect((await page.goto('/w/delos/issue/not_an_id'))?.status()).toBe(404);
});

test('inline title, properties and activity', async ({ page }) => {
  await ready(page);
  const t = page.getByLabel('Title');
  await t.fill('Board DnD v2'); await t.press('Enter');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('changed the title');
  await page.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: /in progress|todo|backlog|done|review/i }).first().click();
  await page.getByRole('combobox', { name: /Change status/ }).fill('done');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set status to Done');
  await page.getByLabel('Estimate').selectOption('5');
  await expect(page.getByRole('list', { name: 'Activity' })).toContainText('set estimate to 5');
  await page.getByLabel('Due date').fill('2026-10-20');
  await expect(page.getByText('Overdue')).toBeVisible();
});

test('markdown editor is safe: no script/raw html, unsafe links dropped', async ({ page }) => {
  await ready(page);
  await page.getByRole('tab', { name: 'Write' }).click();
  await page.getByLabel('Description (markdown)').fill('**bold** <img src=x onerror=window.__x=1> [bad](javascript:alert(1)) [ok](https://linear.app)');
  await page.getByRole('tab', { name: 'Preview' }).click();
  const view = page.locator('.md-view');
  await expect(view.locator('strong')).toHaveText('bold');
  await expect(view.locator('img')).toHaveCount(0);
  await expect(view.getByRole('link', { name: 'bad' })).toHaveCount(0);
  await expect(view.getByRole('link', { name: 'ok' })).toHaveAttribute('rel', /noopener/);
  expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
});

test('comments: mention autocomplete, reply thread, reactions', async ({ page }) => {
  await ready(page);
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await box.click(); await box.pressSequentially('hey @li');
  await expect(page.getByRole('listbox', { name: 'Mention a teammate' })).toContainText('Linus Patch');
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue('hey @linus ');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const c = page.getByRole('article', { name: /Comment by/ }).first();
  await expect(c.locator('.mention')).toHaveText('@linus');
  await c.getByRole('button', { name: /React 👍/ }).click();
  await expect(c.getByRole('button', { name: 'React 👍, 1' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  const r = page.getByRole('combobox', { name: 'Reply' });
  await r.fill('on it'); await r.press('Control+Enter');
  await expect(page.locator('.replies .cmt')).toContainText('on it');
});

test('sub-issues, relations, attachments', async ({ page }) => {
  await ready(page);
  await page.getByLabel('New sub-issue title').fill('Write e2e');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sub-issues/ })).toContainText('0/1');
  await page.getByRole('button', { name: 'Add relation' }).click();
  await page.getByRole('menuitem', { name: /Blocks/ }).click();
  await page.getByRole('combobox', { name: /Add relation/ }).fill('CI');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Relations' }).locator('..')).toContainText('Set up CI');
  await page.getByRole('button', { name: 'Add link' }).click();
  await page.getByLabel('Link URL').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByRole('status')).toContainText('valid http');
  await page.getByLabel('Link URL').fill('https://github.com/meg-abyte-delos/mini-linear/pull/1');
  await page.getByLabel('Link title').fill('PR #1');
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByRole('link', { name: 'PR #1' })).toHaveAttribute('href', /github.com/);
});

test('copy branch shortcut, archive, delete and restore', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page.locator('body').click();
  await page.keyboard.press('Control+Shift+.');
  await expect(page.getByRole('status')).toContainText('Copied branch name');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('meg/del-3-board-drag-and-drop');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('.idp-banner')).toContainText('Archived');
  await page.getByRole('button', { name: 'Unarchive' }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.idp-banner')).toContainText('trash');
  await expect(page.getByLabel('Title')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.idp-banner')).toHaveCount(0);
});
