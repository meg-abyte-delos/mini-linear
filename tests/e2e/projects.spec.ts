import { test, expect } from '@playwright/test';

test('projects view lists projects with progress and drills into issues', async ({ page }) => {
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  await expect(page.locator('.cycle.project')).toHaveCount(2);
  await page.locator('.cycle.project[data-project="p2"]').getByRole('button', { name: 'View issues' }).click();
  await expect(page).toHaveURL(/project=p2/);
  await expect(page.getByRole('button', { name: /^Project: Cronkit/ })).toBeVisible();
});

test('palette: Go to project, Assign to me, Copy issue id', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('assign to me');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/^Assigned to /)).toBeVisible();
  const id = (await page.locator('.row[aria-selected="true"] .id').first().textContent())!;
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('copy issue id');
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Copied ${id}`)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('go to project…');
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: /^Mini Linear/ }).click();
  await expect(page).toHaveURL(/project=p1/);
});

test('projects list shows status, lead, target date; roadmap toggle draws bars', async ({ page }) => {
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  const row = page.locator('.pj-row[data-project="p1"]');
  await expect(row).toContainText('In progress');
  await expect(row).toContainText('Meg Abyte');
  await expect(page.getByTestId('target-p1')).toContainText('Target Nov 20');
  await page.getByRole('group', { name: 'Projects display' }).getByRole('button', { name: 'Roadmap' }).click();
  await expect(page.locator('.rm-bar')).toHaveCount(2);
  await expect(page.getByRole('img', { name: /^Mini Linear: Sep 14 to Nov 20/ })).toBeVisible();
  await page.getByRole('group', { name: 'Projects display' }).getByRole('button', { name: 'List' }).click();
  await expect(page.locator('.pj-row')).toHaveCount(2);
});

test('roadmap shows a month axis and a today marker', async ({ page }) => {
  await page.goto('/?view=projects');
  await page.waitForSelector('html[data-ready]');
  await page.getByRole('group', { name: 'Projects display' }).getByRole('button', { name: 'Roadmap' }).click();
  await expect(page.getByRole('list', { name: 'Months' }).getByRole('listitem').first()).toContainText(/\w{3} 20\d\d/);
  await expect(page.getByTestId('rm-today').first()).toBeAttached();
  await expect(page.getByTestId('rm-pill')).toHaveText('Today');
});

test('roadmap axis: sticky header, pill and month labels pass axe contrast in dark and light', async ({ page }) => {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/?view=projects');
    await page.waitForSelector('html[data-ready]');
    await page.getByRole('group', { name: 'Projects display' }).getByRole('button', { name: 'Roadmap' }).click();
    await expect(page.getByTestId('rm-pill')).toBeVisible();
    const r = await new AxeBuilder({ page }).include('.rm-head').withRules(['color-contrast']).analyze();
    expect(r.violations.map((v) => `${scheme}: ${v.id}`)).toEqual([]);
    expect(r.passes.length + r.incomplete.length).toBeGreaterThan(0);
  }
});
