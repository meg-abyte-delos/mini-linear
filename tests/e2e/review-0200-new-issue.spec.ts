import { test, expect } from '@playwright/test';

// UI review 02:00: New issue modal gets a ghost paperclip and a more-properties chip; Cmd+K tells Select all from Select / unselect.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('c');
});
const modal = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'New issue' });

test('footer: ghost paperclip sits left of Create more and opens the link form', async ({ page }) => {
  const d = modal(page);
  const clip = d.getByRole('button', { name: 'Attach link' });
  await expect(clip).toBeVisible();
  const c = (await clip.boundingBox())!; const m = (await d.getByRole('switch', { name: 'Create more' }).boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(m.x);
  await clip.click();
  await expect(d.getByLabel('Link URL')).toBeFocused();
  await d.getByLabel('Link URL').fill('not a url');
  await d.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(d.getByRole('alert')).toHaveText('Enter a valid http(s) URL.');
  await d.getByLabel('Link URL').fill('https://example.com/spec');
  await d.getByLabel('Link title').fill('Spec');
  await d.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(d.getByRole('list', { name: 'Attachments' })).toContainText('Spec');
  await d.getByRole('button', { name: 'Remove attachment Spec' }).click();
  await expect(d.getByRole('list', { name: 'Attachments' })).toHaveCount(0);
  await expect(d).toBeVisible();
});

test('chips row ends with a ··· chip that opens the extra properties; Cycle adds a chip', async ({ page }) => {
  const d = modal(page);
  const props = d.getByRole('group', { name: 'Properties' });
  await expect(props.getByRole('button').last()).toHaveAccessibleName('More properties');
  await props.getByRole('button', { name: 'More properties' }).click();
  await expect(page.locator('.combo-opt').filter({ hasText: /^Cycle$/ })).toBeVisible();
  await page.locator('.combo-opt').filter({ hasText: /^Cycle$/ }).click();
  await page.locator('.combo-opt').filter({ hasText: /^Cycle 1$/ }).click();
  await expect(props.getByRole('button', { name: 'Cycle 1' })).toBeVisible();
  await expect(props.getByRole('button').last()).toHaveAccessibleName('More properties');
});

test('Cmd+K: Select all issues has its own icon', async ({ page }) => {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('select');
  const rows = page.locator('[id^=pc-]');
  const d = (l: string) => rows.filter({ hasText: l }).first().locator('.pal-ic svg path').evaluateAll((p) => p.map((x) => x.getAttribute('d')).join('|'));
  const all = await d('Select all issues'); const one = await d('Select / unselect');
  expect(all).not.toBe('');
  expect(all).not.toBe(one);
});
