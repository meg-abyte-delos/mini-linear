import { test, expect } from '@playwright/test';

// Board gets the Display popover (Linear parity): Ordering, Show sub-issues and card properties. Grouping is List-only (board columns are statuses).
const openBoard = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('button', { name: /board/i }).click();
  await expect(page.locator('.board .card').first()).toBeVisible();
};

test('board: Display button opens options without Grouping; card properties toggle ID and priority on cards', async ({ page }) => {
  await openBoard(page);
  const btn = page.locator('#fb-display');
  await expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
  await btn.click();
  const dlg = page.getByRole('dialog', { name: 'Display options' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Ordering')).toBeVisible();
  await expect(dlg.getByLabel('Grouping')).toHaveCount(0);
  await expect(dlg.getByRole('button', { name: 'Cycle' })).toHaveCount(0);
  expect(await page.locator('.board .card .id').count()).toBeGreaterThan(0);
  await dlg.getByRole('button', { name: 'ID', exact: true }).click();
  await expect(page.locator('.board .card .id')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Priority', exact: true }).click();
  await expect(page.locator('.board .card .card-prio')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Assignee', exact: true }).click(); // ID and Assignee both off: no empty card-top row
  await expect(page.locator('.board .card .card-top')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect(btn).toBeFocused();
});

test('board: Ordering Priority sorts a column by priority and turns drag off with a note', async ({ page }) => {
  await openBoard(page);
  await page.locator('#fb-display').click();
  const dlg = page.getByRole('dialog', { name: 'Display options' });
  await dlg.getByLabel('Ordering').click();
  await page.getByRole('menu', { name: 'Ordering' }).locator('[role=menuitem]').filter({ hasText: 'Priority' }).click();
  await expect(dlg.getByLabel('Ordering')).toHaveAttribute('data-value', 'priority');
  await expect(dlg.getByRole('note')).toContainText('Set Ordering to Manual');
  await expect(page.locator('.board .card[draggable=true]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const prios = await page.locator('.board section, .board [data-testid^=col-]').first().locator('.card-prio').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
  const rank = (t: string) => ['Urgent', 'High', 'Medium', 'Low'].indexOf(t);
  expect(prios.length).toBeGreaterThan(1);
  const r = prios.map(rank).map((x) => (x < 0 ? 9 : x));
  expect([...r].sort((a, b) => a - b)).toEqual(r);
});
