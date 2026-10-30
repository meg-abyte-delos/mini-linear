import { test, expect, type Page } from '@playwright/test';
import { API_MODE, DEMO } from './helpers/auth';

// Search page inside the app chrome (sidebar, highlight, snippets) and the Filter menu (icons, "Filter…" input, keyboard). API mode, demo session.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1 and ML_TEAM_ID');
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const WORD = `quokka${stamp}`;
const home = async (page: Page) => { await page.goto('/'); await page.waitForSelector('html[data-ready]'); await expect(page.getByRole('option').first()).toBeVisible(); };

test.describe('/search in the app shell', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/demo.json', baseURL: test.info().project.use.baseURL });
    const r = await ctx.request.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: DEMO.teamId, title: `${WORD} in the title`, description: '' } });
    expect(r.status()).toBe(201);
    const r2 = await ctx.request.post(`/api/v1/w/${DEMO.slug}/issues`, { data: { team_id: DEMO.teamId, title: `plain title ${stamp}`, description: `long description that mentions ${WORD} deep inside the body text` } });
    expect(r2.status()).toBe(201);
    await ctx.close();
  });

  test('renders the app sidebar and links back into the app', async ({ page }) => {
    await page.goto(`/search?q=${WORD}`);
    const side = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(side).toBeVisible();
    await expect(side.getByRole('link', { name: 'Inbox' })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(side.getByRole('button', { name: /Delos/ })).toBeVisible();
    await side.getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL(/view=projects/);
  });

  test('highlights the term in titles and shows a snippet only when the match is in the description', async ({ page }) => {
    await page.goto(`/search?q=${WORD}`);
    const rows = page.getByRole('list', { name: 'Results' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    const byTitle = rows.filter({ hasText: 'in the title' });
    await expect(byTitle.locator('.search-title mark')).toHaveText(WORD);
    await expect(byTitle.getByTestId('search-snippet')).toHaveCount(0);
    const byBody = rows.filter({ hasText: `plain title ${stamp}` });
    await expect(byBody.getByTestId('search-snippet').locator('mark')).toHaveText(WORD);
    await expect(byBody.getByTestId('search-snippet')).toContainText('deep inside');
  });
});

test.describe('Filter menu', () => {
  test('has a Filter… input focused first, an icon per category, and filters by typing', async ({ page }) => {
    await home(page);
    await page.locator('#fb-add').click();
    const menu = page.getByRole('menu', { name: 'Filter by' });
    const input = menu.getByRole('searchbox', { name: 'Filter…' });
    await expect(input).toBeFocused();
    const items = menu.getByRole('menuitem');
    await expect(items).toHaveText(['Status', 'Priority', 'Assignee', 'Label', 'Project', 'Cycle']);
    for (let i = 0; i < 6; i++) await expect(items.nth(i).locator('svg').first()).toBeVisible();
    await input.fill('pro');
    await expect(items).toHaveText(['Project']);
    await input.fill('zzz');
    await expect(items).toHaveCount(0);
    await expect(menu.getByText('No filters match')).toBeVisible();
  });

  test('keyboard: arrows move through rows, ArrowUp from the first row returns to the input, Enter opens a picker, Escape refocuses the button', async ({ page }) => {
    await home(page);
    await page.locator('#fb-add').click();
    const menu = page.getByRole('menu', { name: 'Filter by' });
    const items = menu.getByRole('menuitem');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(5)).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('prio');
    await page.keyboard.press('Enter'); // Enter in the input picks the first match
    await expect(page.getByRole('combobox', { name: /Filter by priority/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#fb-add').click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.locator('#fb-add')).toBeFocused();
  });

  test('Space on a focused row activates it instead of moving focus to the input', async ({ page }) => {
    await home(page);
    await page.locator('#fb-add').click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.getByRole('combobox', { name: /Filter by status/ })).toBeVisible();
  });

  test('typing from a row goes back to the input', async ({ page }) => {
    await home(page);
    await page.locator('#fb-add').click();
    const menu = page.getByRole('menu', { name: 'Filter by' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('lab');
    await expect(menu.getByRole('searchbox')).toHaveValue('lab');
    await expect(menu.getByRole('menuitem')).toHaveText(['Label']);
  });
});
