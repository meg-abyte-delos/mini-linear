
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { API_MODE, DEMO, apiCreateIssue } from './helpers/auth';

// Search (palette + /search) and Inbox against the real stack: Postgres FTS route and real notifications (ML_API=1 + demo seed).
// Notifications need a second actor, so the spec inserts rows as OWNER (DATABASE_OWNER_URL) for the demo user. Skipped in mock mode.
test.skip(!API_MODE || !DEMO.teamId || !process.env.DATABASE_OWNER_URL, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID, DATABASE_OWNER_URL and the demo seed');
test.describe.configure({ mode: 'serial' });

const sql = postgres(process.env.DATABASE_OWNER_URL ?? '', { max: 1 });
test.afterAll(async () => { await sql.end({ timeout: 2 }); });

// Fixed ids of the demo seed (scripts/seed-demo.mts): workspace ...0001, user ...0002.
const WS = '00000000-0000-4000-8000-000000000001', USER = '00000000-0000-4000-8000-000000000002';
async function notify(issueId: string, types: string[]) {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${WS}, true), set_config('app.user_id', ${USER}, true)`;
    for (const t of types)
      await tx`insert into notifications (id, workspace_id, user_id, actor_id, type, issue_id) values (${randomUUID()}, ${WS}, ${USER}, null, ${t}::notification_type, ${issueId})`;
  });
}
// The badge and the dots count unread ROWS (one per issue, see unreadRows in inbox-client), not raw notifications:
// replies in a thread can leave several unread notifications on one issue, so compare against the same grouping.
const unreadCount = async (page: import('@playwright/test').Page) => {
  const j = (await (await page.request.get(`/api/v1/w/${DEMO.slug}/notifications?limit=100`)).json()) as { items: { issue_id: string; read_at: string | null }[] };
  const unreadIssues = new Set(j.items.filter((n) => !n.read_at).map((n) => n.issue_id));
  return unreadIssues.size;
};

test.describe('Search on the server route', () => {
  test('palette finds an issue through /search and Enter opens it', async ({ page }) => {
    const word = `zebrafish${Date.now()}`;
    const issue = await apiCreateIssue(page, `${word} palette target`);
    await page.goto('/'); await page.waitForSelector('html[data-ready]');
    const calls: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`/w/${DEMO.slug}/search`)) calls.push(r.url()); });
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).pressSequentially(word, { delay: 15 });
    const opt = page.getByRole('listbox', { name: 'Commands' }).getByRole("option", { name: new RegExp(`${word} palette target`) });
    await expect(opt).toBeVisible();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(word.length - 2); // debounced: not one request per keystroke
    await opt.click();
    await expect(page.getByRole('complementary', { name: 'Issue detail' })).toContainText(`${word} palette target`);
    expect(issue.id).toBeTruthy();
  });

  test('palette shows loading, empty and error states', async ({ page }) => {
    await page.goto('/'); await page.waitForSelector('html[data-ready]');
    const box = page.getByRole('combobox', { name: 'Search commands' });
    // loading: hold the response
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/search?*', async (route) => { await gate; await route.continue(); });
    await page.keyboard.press('Control+k');
    await box.fill('qqzzxxnomatch');
    await expect(page.getByTestId('palette-searching')).toBeVisible();
    release();
    await expect(page.getByTestId('palette-no-results')).toHaveText(/No results for/);
    // One message plus exactly one Search all row under it, no separate entries.
    const opts = page.getByRole('listbox', { name: 'Commands' }).getByRole('option');
    await expect(opts).toHaveCount(1);
    await expect(opts.first()).toHaveText(/Search all for/);
    await expect(page.getByTestId('palette-searching')).toHaveCount(0);
    // error
    await page.unroute('**/search?*');
    await page.route('**/search?*', (route) => route.fulfill({ status: 500, body: '{}' }));
    await box.fill('qqzzxxfails');
    await expect(page.getByTestId('palette-search-error')).toBeVisible();
  });

  test('/search page lists server results', async ({ page }) => {
    const word = `quokka${Date.now()}`;
    await apiCreateIssue(page, `${word} results page`);
    await page.goto(`/search?q=${word}`);
    await expect(page.getByRole('list', { name: 'Results' }).getByRole('listitem').first()).toContainText(`${word} results page`);
    await page.getByRole('textbox', { name: 'Search' }).fill('qqzzxxnomatch');
    await expect(page.getByText(/No results for/)).toBeVisible();
  });
});

test.describe('Inbox on real notifications', () => {
  test('lists, marks read, snoozes and archives through the API', async ({ page }) => {
    // The inbox shows one row per issue, so three notifications need three issues (shared title prefix keeps the row filter simple).
    const title = `inbox-${Date.now()}`;
    for (const [i, type] of (['assigned', 'comment', 'status_change'] as const).entries())
      await notify((await apiCreateIssue(page, `${title} ${i}`)).id, [type]);
    await page.goto('/?view=inbox'); await page.waitForSelector('html[data-ready]');
    const rows = page.getByRole('option').filter({ hasText: title });
    await expect(rows).toHaveCount(3);
    const before = await unreadCount(page);
    await expect(page.getByTestId('inbox-badge')).toHaveText(String(Math.min(before, 99)));
    // read
    // a click shows the notification, which marks it read (Linear); u then toggles it back to unread
    await rows.first().click();
    await expect.poll(() => unreadCount(page)).toBe(before - 1);
    await page.keyboard.press('u');
    await expect.poll(() => unreadCount(page)).toBe(before);
    // snooze one (press 1 = later today): it leaves All, appears under Snoozed
    await rows.first().click();
    await page.keyboard.press('s');
    // Wait for the server to commit: the Snoozed tab reads from the API and would race the optimistic update.
    const snoozed = page.waitForResponse((r) => r.url().includes('/snooze') && r.request().method() === 'POST');
    await page.keyboard.press('1');
    expect((await snoozed).ok()).toBe(true);
    await expect(rows).toHaveCount(2);
    await page.getByRole('tab', { name: 'Snoozed' }).click();
    await expect(page.getByRole('option').filter({ hasText: title })).toHaveCount(1);
    // archive another from All
    await page.getByRole('tab', { name: 'All' }).click();
    await expect(rows).toHaveCount(2);
    await rows.first().click();
    const archived = page.waitForResponse((r) => r.url().includes('/archive') && r.request().method() === 'POST');
    await page.keyboard.press('e');
    expect((await archived).ok()).toBe(true);
    await expect(rows).toHaveCount(1);
    await page.getByRole('tab', { name: 'Archived' }).click();
    await expect(page.getByRole('option').filter({ hasText: title })).toHaveCount(1);
    // state really persisted on the server
    await page.reload(); await page.waitForSelector('html[data-ready]');
    await page.getByRole('tab', { name: 'Archived' }).click();
    await expect(page.getByRole('option').filter({ hasText: title })).toHaveCount(1);
  });

  test('refreshes on the SSE feed: a notification created elsewhere appears without reload', async ({ page, browser }) => {
    const title = `inbox-live-${Date.now()}`;
    const issue = await apiCreateIssue(page, title);
    await page.goto('/?view=inbox'); await page.waitForSelector('html[data-ready]');
    await expect(page.getByRole('option').filter({ hasText: title })).toHaveCount(0);
    await notify(issue.id, ['mention']);
    // The inbox reloads on change-feed activity: a rename from another tab is that activity.
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/demo.json' });
    const other = await ctx.newPage();
    await other.goto('/'); await other.waitForSelector('html[data-ready]');
    const cur = (await (await other.request.get(`/api/v1/w/${DEMO.slug}/issues/${issue.id}`)).json()) as { version: number };
    const res = await other.request.patch(`/api/v1/w/${DEMO.slug}/issues/${issue.id}`, { data: { title: `${title} renamed` }, headers: { 'if-match': `"${cur.version}"` } });
    expect(res.ok()).toBeTruthy();
    await expect(page.getByRole('option').filter({ hasText: title })).toHaveCount(1, { timeout: 10_000 });
    await ctx.close();
  });
});
