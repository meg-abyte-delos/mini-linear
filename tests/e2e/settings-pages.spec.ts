import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ reducedMotion: 'reduce' });
// One page per settings nav entry, same shell and nav everywhere (Account, Workspace, Your teams). API mode, demo session = owner.
test('settings: every nav entry is its own page with the same nav, per-team page, axe clean', async ({ page }) => {
  await page.goto('/w/demo/settings');
  const nav = page.getByRole('navigation', { name: 'Settings' });
  const entries = ['Profile', 'Preferences', 'General', 'Members', 'Teams', 'Notifications'];
  for (const name of entries) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(nav.getByText('Your teams')).toBeVisible();
  const teamLinks = nav.getByRole('group', { name: 'Your teams' }).getByRole('link');
  expect(await teamLinks.count()).toBeGreaterThan(0);
  // General no longer stacks teams or notifications.
  await expect(page.getByRole('heading', { name: 'Notifications' })).toHaveCount(0);
  await expect(page.getByLabel('Team name')).toHaveCount(0);

  for (const [name, h1] of [['Notifications', 'Notifications'], ['Teams', 'Teams'], ['Profile', 'Profile'], ['Preferences', 'Preferences'], ['Members', 'Members']] as const) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: h1, level: 1 })).toBeVisible();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`), name).toEqual([]);
  }

  const first = teamLinks.first();
  const teamName = (await first.innerText()).trim();
  await first.click();
  await expect(page.getByRole('heading', { name: teamName, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add state' })).toBeVisible();
  await expect(nav.getByRole('link', { name: teamName, exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main')).toHaveCount(1);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
});

test('settings: unknown team page says so', async ({ page }) => {
  await page.goto('/w/demo/settings/teams/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('heading', { name: 'Team not found', level: 1 })).toBeVisible();
});
