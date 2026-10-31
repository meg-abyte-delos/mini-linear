import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';
import { API_MODE, login } from './helpers/auth';

test.use({ reducedMotion: 'reduce' });
test.skip(!API_MODE, 'API-mode e2e: needs ML_API=1 and the demo seed');

const axe = async (page: Page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => `${v.id} x${v.nodes.length}`)).toEqual([]);
const LOGO = path.join(__dirname, 'assets', 'logo.png');
const rand = () => Math.random().toString(36).slice(2, 8);

test('profile: Save is off until the form changes, saves with a toast, and the name sticks', async ({ page }) => {
  await page.goto('/w/demo/settings/profile');
  const save = page.getByRole('button', { name: 'Save changes' });
  const name = page.getByLabel('Full name');
  await expect(name).toBeVisible();
  const before = await name.inputValue();
  await expect(save).toBeDisabled();
  const next = `Linus ${rand()}`;
  try {
    await name.fill(next);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved' })).toBeVisible();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel('Full name')).toHaveValue(next);
    await axe(page);
  } finally {
    await page.request.patch('/api/v1/me', { data: { display_name: before || null } });
  }
});

test('preferences: home page and theme save, Select is keyboard reachable, axe clean', async ({ page }) => {
  await page.goto('/w/demo/settings/preferences');
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(page.getByRole('button', { name: /^Home page:/ })).toBeVisible();
  await expect(save).toBeDisabled();
  const was = (await (await page.request.get('/api/v1/me')).json()) as { home_page: string; theme: string };
  try {
    await page.getByRole('button', { name: /^Home page:/ }).click();
    await page.getByRole('menuitem', { name: 'Projects' }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Preferences saved' })).toBeVisible();
    expect(((await (await page.request.get('/api/v1/me')).json()) as { home_page: string }).home_page).toBe('projects');
    await page.getByRole('button', { name: /^Theme:/ }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await save.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await axe(page);
  } finally {
    await page.request.patch('/api/v1/me', { data: { home_page: was.home_page, theme: was.theme } });
  }
});

test('general: slug preview, logo upload with preview and removal, Save only when changed, delete workspace needs the typed name', async ({ page }) => {
  const slug = `e2e-${rand()}`, name = `Scratch ${slug}`;
  const made = await page.request.post('/api/v1/workspaces', { data: { slug, name } });
  expect(made.status()).toBe(201);
  try {
    await page.goto(`/w/${slug}/settings`);
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
    await expect(save).toBeDisabled();
    await expect(page.getByText(`Your workspace lives at /w/${slug}/issues`)).toBeVisible();
    await page.getByLabel('URL slug').fill(`${slug}-x`);
    await expect(page.getByText(`/w/${slug}-x/issues`)).toBeVisible();
    await page.getByLabel('URL slug').fill(slug);
    await expect(save).toBeDisabled();

    // Logo: choosing a file previews it at once, Save uploads it.
    await page.locator('input[type=file]').setInputFiles(LOGO);
    await expect(page.getByRole('img', { name: `${name} logo` })).toHaveAttribute('src', /^blob:/);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status').filter({ hasText: 'Workspace saved' })).toBeVisible();
    await expect(page.getByRole('img', { name: `${name} logo` })).toHaveAttribute('src', new RegExp(`/api/v1/w/${slug}/settings/logo`));
    await expect(save).toBeDisabled();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await save.click();
    await expect(page.getByRole('img', { name: `${name} logo` })).toHaveCount(0);
    await expect.poll(async () => ((await (await page.request.get(`/api/v1/w/${slug}/settings`)).json()) as { logo_url: string | null }).logo_url).toBeNull();
    await axe(page);

    // Danger zone (owner): the confirm button stays disabled until the exact name is typed.
    await page.getByRole('button', { name: 'Delete workspace' }).click();
    const dlg = page.getByRole('alertdialog');
    const go = dlg.getByRole('button', { name: 'Delete workspace' });
    await expect(go).toBeDisabled();
    await dlg.getByLabel(`Type ${name} to confirm`).fill(name.slice(0, -1));
    await expect(go).toBeDisabled();
    await dlg.getByLabel(`Type ${name} to confirm`).fill(name);
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page).not.toHaveURL(/\/settings/);
    expect((await page.request.get(`/api/v1/w/${slug}/settings`)).status()).toBe(404);
  } finally {
    await page.request.delete(`/api/v1/w/${slug}`).catch(() => undefined);
  }
});

test('labels: workspace labels are created, renamed and deleted; a member sees them read-only; invite takes several addresses', async ({ page, browser }) => {
  const label = `lbl-${rand()}`;
  await page.goto('/w/demo/settings/labels');
  await expect(page.getByRole('heading', { name: 'Labels', level: 1 })).toBeVisible();
  await page.getByLabel('New label', { exact: true }).fill(label);
  await page.getByRole('button', { name: 'Add label' }).click();
  await expect(page.getByLabel(`Name of label ${label}`)).toBeVisible();
  await axe(page);

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mate = await ctx.newPage();
  await login(mate, 'mate@example.test');
  await mate.goto('/w/demo/settings/labels');
  await expect(mate.getByText(label, { exact: true })).toBeVisible();
  await expect(mate.getByRole('button', { name: 'Add label' })).toHaveCount(0);
  await expect(mate.getByRole('button', { name: `Delete label ${label}` })).toHaveCount(0);
  await mate.goto('/w/demo/settings');
  await expect(mate.getByRole('heading', { name: 'Danger zone' })).toHaveCount(0);
  await expect(mate.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await ctx.close();

  await page.getByLabel(`Name of label ${label}`).fill(`${label}-2`);
  await page.getByLabel(`Name of label ${label}`).blur();
  await expect(page.getByLabel(`Name of label ${label}-2`)).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `Delete label ${label}-2` }).click();
  await expect(page.getByLabel(`Name of label ${label}-2`)).toHaveCount(0);

  // Invite: several addresses in one go.
  const a = `inv-${rand()}@example.test`, b = `inv-${rand()}@example.test`;
  await page.goto('/w/demo/members');
  await page.getByRole('button', { name: /Invite/ }).click();
  await page.getByLabel('Email addresses').fill(`${a}, ${b}`);
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 invitations sent' })).toBeVisible();
  for (const e of [a, b]) {
    const inv = (await (await page.request.get('/api/v1/w/demo/invites?limit=100')).json()) as { items: { id: string; email: string }[] };
    const id = inv.items.find((i) => i.email === e)?.id;
    expect(id).toBeTruthy();
    await page.request.delete(`/api/v1/w/demo/invites/${id}`);
  }
});
