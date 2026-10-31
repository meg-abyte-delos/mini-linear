import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { API_MODE, DEMO, login } from './helpers/auth';
import { GUEST_STATE } from './global-setup';

test.use({ reducedMotion: 'reduce' });
test.skip(!API_MODE, 'API-mode e2e: needs ML_API=1 and the demo seed');

// "Your teams" lists only teams the viewer belongs to (admins: all). Seeded: demo = admin, mate = non-admin member, guest = guest.
test('member: a team they are not in is absent from Your teams and its URL is Team not found; team settings are read-only', async ({ page, browser }) => {
  const key = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const name = `Solo ${key}`;
  const made = await page.request.post(`/api/v1/w/${DEMO.slug}/teams`, { data: { name, key } });
  expect(made.status()).toBe(201);
  const solo = (await made.json()) as { id: string };
  try {
    // Admin control: sees every team, including the one nobody else is in.
    await page.goto(`/w/${DEMO.slug}/settings`);
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name, exact: true })).toBeVisible();

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const mate = await ctx.newPage();
    await login(mate, 'mate@example.test');
    await mate.goto(`/w/${DEMO.slug}/settings`);
    const nav = mate.getByRole('navigation', { name: 'Settings' });
    const group = nav.getByRole('group', { name: 'Your teams' });
    await expect(group.getByRole('link').first()).toBeVisible();
    await expect(group.getByRole('link', { name, exact: true })).toHaveCount(0);

    await mate.goto(`/w/${DEMO.slug}/settings/teams/${solo.id}`);
    await expect(mate.getByRole('heading', { name: 'Team not found', level: 1 })).toBeVisible();

    // A team they are in opens read-only: the controls are disabled, no 403 toast to provoke.
    await group.getByRole('link').first().click();
    await expect(mate.getByText('Only workspace admins can change these settings.')).toBeVisible();
    await expect(mate.getByRole('button', { name: 'Add state' })).toBeDisabled();
    await expect(mate.getByRole('button', { name: 'Add label' })).toBeDisabled();
    const r = await new AxeBuilder({ page: mate }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
    await ctx.close();
  } finally {
    await page.request.delete(`/api/v1/w/${DEMO.slug}/teams/${solo.id}`);
  }
});

test.describe('guest', () => {
  test.use({ storageState: GUEST_STATE });
  test('guest: no Your teams block in the settings nav', async ({ page }) => {
    await page.goto(`/w/${DEMO.slug}/settings`);
    const nav = page.getByRole('navigation', { name: 'Settings' });
    await expect(nav.getByRole('link', { name: 'General', exact: true })).toBeVisible();
    await expect(nav.getByText('Your teams')).toHaveCount(0);
    await expect(nav.getByRole('group')).toHaveCount(0);
  });
});

// The nav's team sub-list (a role=group with display:contents spans around the links) must stay axe clean for an admin too.
test('admin: nav team sub-list is axe clean', async ({ page }) => {
  await page.goto(`/w/${DEMO.slug}/settings`);
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('group', { name: 'Your teams' })).toBeVisible();
  const r = await new AxeBuilder({ page }).include('nav[aria-label=Settings]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
});
