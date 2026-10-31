import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';


// Axe samples colors at one instant: with the 120ms motion tokens (#216) a fading row/toast reads as low contrast on slow CI runners.
test.use({ reducedMotion: 'reduce' });
// D6: settings layout (left nav, centered column) and the Members page (search, invite, row actions). API mode, demo session = owner.
test('settings page: left nav, primitives, delete team confirms in a dialog, axe clean', async ({ page }) => {
  await page.goto('/w/demo/settings');
  const nav = page.getByRole('navigation', { name: 'Settings' });
  await expect(nav.getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveAttribute('href', '/w/demo/members');
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  // Content is a centered column no wider than 720px next to the 220px nav.
  const wrap = await page.locator('.set-wrap').boundingBox();
  expect(wrap!.width).toBeLessThanOrEqual(720);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // Teams live on their own page; create a throwaway team, then delete it through the confirm dialog (no window.confirm).
  await nav.getByRole('link', { name: 'Teams', exact: true }).click();
  await expect(page).toHaveURL(/\/w\/demo\/settings\/teams$/);
  await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible();
  await page.getByLabel('Team name').fill('Zeta Scratch');
  await page.getByRole('button', { name: 'Create team' }).click();
  await page.getByRole('button', { name: 'Delete team Zeta Scratch' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('cannot be undone');
  await expect(dlg.getByRole('button', { name: 'Delete team' })).toHaveAttribute('data-tone', 'danger');
  // Deleting needs the exact team name typed first.
  await expect(dlg.getByRole('button', { name: 'Delete team' })).toBeDisabled();
  await dlg.getByLabel('Type Zeta Scratch to confirm').fill('Zeta Scratch');
  await dlg.getByRole('button', { name: 'Delete team' }).click();
  await expect(page.getByRole('button', { name: 'Delete team Zeta Scratch' })).toHaveCount(0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
});

test('members page: search filters, invite sends and lists a pending invite, revoke removes it, axe clean', async ({ page }) => {
  await page.goto('/w/demo/members');
  await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
  const rows = page.getByTestId('member-row');
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  const first = (await rows.first().locator('td').nth(1).innerText()).trim();
  await page.getByRole('searchbox', { name: 'Search members' }).fill(first);
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search members' }).fill('no-such-person-xyz');
  await expect(page.getByText('No members match')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search members' }).fill('');
  await expect(rows).toHaveCount(total);

  const email = `d6-${Date.now()}@example.test`;
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Invite people' });
  await form.getByLabel('Email').fill(email);
  await form.getByRole('button', { name: 'Send invite' }).click();
  const inv = page.getByTestId('invite-row').filter({ hasText: email });
  await expect(inv).toHaveCount(1);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);

  await inv.getByRole('button', { name: /Actions for invitation/ }).click();
  await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
  await expect(inv).toHaveCount(0);
});

test('members page: inline role dropdown, role tabs, row menu with a red Remove that asks to confirm', async ({ page }) => {
  await page.goto('/w/demo/members');
  const rows = page.getByTestId('member-row');
  await expect(rows.first()).toBeVisible();
  // Tabs filter by role and show their counts.
  await page.getByRole('tab', { name: /^Guests/ }).click();
  for (const r of await rows.all()) await expect(r.getByRole('button', { name: /^Role for/ }).or(r.locator('.set-role-text'))).toContainText(/Guest/i);
  await page.getByRole('tab', { name: /^All/ }).click();
  await expect(page.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
  const others = rows.filter({ has: page.getByRole('button', { name: /^Actions for/ }) });
  test.skip((await others.count()) === 0, 'demo workspace has no other member');
  await others.first().getByRole('button', { name: /^Actions for/ }).click();
  await expect(page.getByRole('menuitem', { name: /^Make / })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Remove from workspace' })).toHaveAttribute('data-destructive', 'true');
  await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('loses access');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(dlg).toHaveCount(0);
});

// Team settings page: its native controls used to keep the browser button face under themed text (1.08:1). Axe AA in both themes.
for (const theme of ['dark', 'light'] as const) {
  test(`team settings: controls pass axe AA contrast (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'ml_theme', value: theme, url: baseURL! }]);
    const teams = await (await page.request.get('/api/v1/w/demo/teams?limit=100')).json() as { items: { id: string }[] };
    test.skip(teams.items.length === 0, 'demo workspace has no team');
    await page.goto(`/settings/teams/${teams.items[0]!.id}?w=demo`);
    await expect(page.getByRole('button', { name: 'Add state' })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
  });
}
