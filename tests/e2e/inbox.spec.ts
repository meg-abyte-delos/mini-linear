import { test, expect } from '@playwright/test';
import { resetInbox } from './reset-inbox';
import { INBOX_STATE } from './global-setup';

// At 1280 the detail pane is under 760px: the Properties rail is a drawer opened from the bar (fix/inbox-detail-reading-width).
async function openRail(page: import('@playwright/test').Page) {
  const toggle = page.getByRole('complementary', { name: 'Notification detail' }).getByRole('button', { name: 'Properties', exact: true });
  // isVisible() does not wait: first let the detail pane mount (#inbox-props in the DOM; a closed drawer is visibility:hidden, so a role query would never match), then decide.
  await page.locator('#inbox-props').waitFor({ state: 'attached' });
  if (await toggle.isVisible() && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

// Own persona and inbox: other specs run as the admin and never touch these notifications.
test.use({ storageState: INBOX_STATE });

test.beforeEach(async () => { await resetInbox(); });

test('inbox: badge, keyboard triage', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByTestId('inbox-badge')).toHaveText('2');
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/w\/demo\/inbox$/);
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('j');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('inbox-badge')).toHaveText('1'); // j shows DEM-2, which reads it
  await page.keyboard.press('u');
  await expect(page.getByTestId('inbox-badge')).toHaveText('2'); // u on a read row marks it unread again
  await page.keyboard.press('e');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.keyboard.press('k');
  await page.keyboard.press('h');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
});

test('inbox: mark all as read and empty state', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible(); // the list loads after hydration: keys pressed earlier hit an empty list
  await page.getByRole('button', { name: 'Inbox options' }).click();
  await page.getByRole('menuitem', { name: 'Mark all as read' }).click();
  await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await expect(page.getByText('Inbox zero')).toBeVisible();
});

test('inbox: tabs, snooze menu, bulk archive, detail panel', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible(); // the list loads after hydration: keys pressed earlier hit an empty list
  await expect(page.getByRole('complementary', { name: 'Notification detail' })).toContainText('DEM-1');
  await page.keyboard.press('s');
  await expect(page.getByRole('menu', { name: 'Snooze until' })).toBeVisible();
  // Wait for the server to commit the snooze: the Snoozed tab reads from the API and would race the optimistic update.
  const snoozed = page.waitForResponse((r) => r.url().includes('/snooze') && r.request().method() === 'POST');
  await page.keyboard.press('2');
  expect((await snoozed).ok()).toBe(true);
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Snoozed' }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByTestId('select-DEM-2').click();
  await page.getByTestId('select-DEM-3').click();
  await expect(page.getByText('2 selected')).toBeVisible();
  // Same race as the snooze: the Archived tab reads from the API while the optimistic update is already on screen.
  let archived = 0;
  const both = new Promise<void>((done) => page.on('response', (r) => { if (r.url().includes('/archive') && r.request().method() === 'POST' && r.ok() && ++archived === 2) done(); }));
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Inbox zero')).toBeVisible();
  await both;
  await page.getByRole('tab', { name: 'Archived' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
});

test('inbox: x toggles selection of the focused notification', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible(); // the list loads after hydration: keys pressed earlier hit an empty list
  // The key handler is re-bound in a passive effect that can lag the commit that renders the rows (seen under CPU load):
  // a first 'x' can hit the previous, empty-list handler and be dropped. Press only while nothing is selected, until it registers.
  await expect(async () => {
    // isVisible() does not wait: give a press that already registered a short moment to render before pressing again (a re-press would unselect).
    const selected = await page.getByText('1 selected').waitFor({ timeout: 300 }).then(() => true, () => false);
    if (!selected) await page.keyboard.press('x');
    await expect(page.getByText('1 selected')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.press('j');
  await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-current', 'true'); // x acts on the focused row: wait for the move
  await page.keyboard.press('x');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('x');
  await expect(page.getByText('1 selected')).toBeVisible();
});

test('inbox: two panes, no List/Board toggle, j/k drives the issue preview', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'View', exact: true })).toHaveCount(0);
  const detail = page.getByRole('complementary', { name: 'Notification detail' });
  const list = page.getByRole('listbox', { name: 'Notifications' });
  await expect(list).toBeVisible();
  await expect(detail).toBeVisible();
  // side by side: the list sits left of the preview and neither overflows the viewport
  const [l, d] = await Promise.all([list.boundingBox(), detail.boundingBox()]);
  expect(l!.x + l!.width).toBeLessThanOrEqual(d!.x + 1);
  expect(d!.x + d!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await expect(detail.getByRole('region', { name: 'Issue preview' })).toBeVisible();
  const first = await detail.getByRole('heading', { level: 2 }).textContent();
  await page.keyboard.press('j');
  await expect(detail.getByRole('heading', { level: 2 })).not.toHaveText(first!);
  await page.keyboard.press('k');
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(first!);
  // mark read / archive from the preview actions
  await detail.getByRole('button', { name: /^Mark (read|unread)\b/ }).click();
  await detail.getByRole('button', { name: /^Archive/ }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
});

test('inbox: the List/Board toggle stays on the issues views', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('group', { name: 'View', exact: true })).toBeVisible();
});

test('shell: the List/Board toggle is hidden on Inbox, Cycles and Projects', async ({ page }) => {
  for (const v of ['inbox', 'cycles', 'projects']) {
    await page.goto(`/?view=${v}`);
    await page.waitForSelector('html[data-ready]');
    await expect(page.getByRole('group', { name: 'View', exact: true })).toHaveCount(0);
  }
  await page.goto('/?view=board');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('group', { name: 'View', exact: true })).toBeVisible();
});

test('inbox: detail shows the issue Properties rail (no Event/When rows), a ghost Open issue, and titles carry a tooltip', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  const detail = page.getByRole('complementary', { name: 'Notification detail' });
  // Linear's rail: the issue page's Properties component, with no Event / When rows (the event is in the row and the activity)
  const rail = detail.getByRole('complementary', { name: 'Properties' });
  await openRail(page);
  await expect(rail.getByRole('heading')).toHaveText(['Properties', 'Planning', 'Organization']);
  await expect(rail.locator('dt')).not.toContainText(['Event', 'When']);
  const statusBtn = rail.getByRole('button', { name: /^(Backlog|Todo|In progress|In review|Done|Canceled)$/i });
  await expect(statusBtn).toBeVisible();
  await expect(statusBtn.locator('svg.si')).toHaveCount(1); // never the raw snake_case enum
  await expect(statusBtn).not.toContainText('_');
  // Open issue is the first action, ghost (Linear has no primary button in this header)
  const first = detail.getByRole('toolbar', { name: 'Notification actions' }).getByRole('button').first();
  await expect(first).toHaveText('Open issue');
  await expect(first).toHaveAttribute('data-variant', 'ghost');
  // truncated text keeps a tooltip with the full value
  const row = page.getByRole('option').first();
  await expect(row.locator('.ntitle')).toHaveAttribute('title', /.+/);
  await expect(row.locator('.nwho')).toHaveAttribute('title', /.+/);
});

test('inbox: the unread counter equals the number of unread dots', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  const dots = await page.locator('li.nrow[data-unread=true]').count();
  await expect(page.getByText(`${dots} unread`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inbox options' }).click();
  await page.getByRole('menuitem', { name: 'Mark all as read' }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.locator('li.nrow[data-unread=true]')).toHaveCount(0);
});

test('inbox: the options menu (Mark all as read marks everything) is only on the All tab', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('button', { name: 'Inbox options' })).toBeVisible();
  for (const name of ['Unread', 'Archived', 'Snoozed']) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('button', { name: 'Inbox options' })).toHaveCount(0);
  }
  await page.getByRole('tab', { name: 'All' }).click();
  await expect(page.getByRole('button', { name: 'Inbox options' })).toBeVisible();
});

test('inbox: dedicated /w/<slug>/inbox route renders the inbox, Inbox is the only active sidebar item and links to it', async ({ page }) => {
  await page.goto('/w/demo/inbox');
  await page.waitForSelector('html[data-ready]');
  await expect(page.getByRole('option').first()).toBeVisible();
  await expect(page.locator('aside.side [aria-current=page]')).toHaveCount(1);
  const link = page.getByRole('link', { name: /^Inbox/ });
  await expect(link).toHaveAttribute('aria-current', 'page');
  await expect(link).toHaveAttribute('href', '/w/demo/inbox');
});

test('inbox: unknown workspace slug on /w/<slug>/inbox is a 404', async ({ page }) => {
  await page.goto('/w/no-such-ws/inbox');
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
});

test('inbox: clicking Inbox rewrites the URL to /w/<slug>/inbox, leaving it restores /?view=, Back returns to the previous view', async ({ page }) => {
  await page.goto('/?view=board');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/w\/demo\/inbox$/);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/\?view=board$/);
  await expect(page.locator('main[data-view=inbox]')).toHaveCount(0);
  await expect(page.locator('main[data-view=board]')).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(/\/w\/demo\/inbox$/);
  await expect(page.locator('main[data-view=inbox]')).toHaveCount(1);
});

test('inbox: leaving the inbox from /w/<slug>/inbox puts the URL back on /?view=..., a reload stays out of the inbox', async ({ page }) => {
  await page.goto('/w/demo/inbox');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('link', { name: /^Issues/ }).first().click();
  await expect(page).toHaveURL(/^[^?]*\/(\?.*)?$/);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await expect(page.locator('main[data-view=inbox]')).toHaveCount(0);
});

test('inbox: opened directly, the sidebar marks Inbox and no Issues link', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  const side = page.getByRole('complementary', { name: 'Sidebar' });
  await expect(side.locator('a.side-link[aria-current="page"]')).toHaveText([/Inbox/]);
});

test('inbox: the Properties rail edits the issue; the list row follows and a reload keeps it', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  const detail = page.getByRole('complementary', { name: 'Notification detail' });
  const rail = detail.getByRole('complementary', { name: 'Properties' });
  await openRail(page);
  await rail.getByRole('button', { name: /^(Backlog|Todo|In progress|In review|Done|Canceled)$/i }).click();
  await page.getByRole('combobox', { name: /Change status/ }).fill('done');
  await page.keyboard.press('Enter');
  await expect(rail.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(page.getByRole('option').first().locator('.nstatus')).toHaveAttribute('data-status', 'done');
  await page.reload();
  await page.waitForSelector('html[data-ready]');
  await openRail(page);
  await expect(page.getByRole('complementary', { name: 'Notification detail' }).getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
});

test('inbox: editing the rail keeps an unsent comment draft', async ({ page }) => {
  await page.goto('/?view=inbox');
  await page.waitForSelector('html[data-ready]');
  const detail = page.getByRole('complementary', { name: 'Notification detail' });
  const box = detail.getByRole('textbox', { name: 'Leave a comment' });
  await box.fill('draft that must survive');
  // Mark the node: a remount (sessionStorage restoring the text) would drop the marker.
  await box.evaluate((el) => { (el as HTMLElement).dataset.sameNode = '1'; });
  const rail = detail.getByRole('complementary', { name: 'Properties' });
  await openRail(page);
  await rail.getByRole('button', { name: /^(Backlog|Todo|In progress|In review|Done|Canceled)$/i }).click();
  await page.getByRole('combobox', { name: /Change status/ }).fill('done');
  await page.keyboard.press('Enter');
  await expect(rail.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const after = detail.getByRole('textbox', { name: 'Leave a comment' });
  await expect(after).toHaveValue('draft that must survive');
  await expect(after).toHaveAttribute('data-same-node', '1');
});

// Properties drawer at 1280 (Rex #408 should-fix 2): aria-expanded, Esc + focus return, scrim, and closing on selection change.
test.describe('inbox: Properties drawer at 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  async function openInbox(page: import('@playwright/test').Page) {
    await page.goto('/?view=inbox');
    await page.waitForSelector('html[data-ready]');
    await expect(page.getByRole('option').first()).toBeVisible();
    const detail = page.getByRole('complementary', { name: 'Notification detail' });
    await page.locator('#inbox-props').waitFor({ state: 'attached' });
    return { detail, toggle: detail.getByRole('button', { name: 'Properties', exact: true }), rail: page.locator('#inbox-props') };
  }

  test('closed by default, the toggle opens it, Esc closes it and returns focus to the toggle', async ({ page }) => {
    const { toggle, rail } = await openInbox(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(rail).toBeVisible();
    await rail.getByRole('button').first().focus(); // focus inside the drawer: closing must not strand it on a hidden element
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('clicking the scrim closes the drawer and returns focus to the toggle', async ({ page }) => {
    const { toggle, rail } = await openInbox(page);
    await toggle.click();
    await expect(rail).toBeVisible();
    await page.locator('.inbox-scrim').click({ position: { x: 5, y: 200 } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('reopening, then j/k to another notification closes it', async ({ page }) => {
    const { toggle, rail } = await openInbox(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(rail).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toBeHidden();
  });
});

test.describe('inbox: Properties rail at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the rail is inline and there is no Properties toggle', async ({ page }) => {
    await page.goto('/?view=inbox');
    await page.waitForSelector('html[data-ready]');
    await expect(page.getByRole('option').first()).toBeVisible();
    await expect(page.locator('#inbox-props')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Notification detail' }).getByRole('button', { name: 'Properties', exact: true })).toBeHidden();
  });
});
