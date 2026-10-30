import { test, expect } from '@playwright/test';

// Review 22:00 (API mode, demo workspace): team-scoped list, sidebar entry per team, issue breadcrumb, no palette footer, danger zone.
test('sidebar lists every team and the list only shows the selected team issues', async ({ page }) => {
  const key = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const made = await page.request.post('/api/v1/w/demo/teams', { data: { name: `Scope ${key}`, key } });
  expect(made.status()).toBe(201);
  const team = (await made.json()) as { id: string; name: string };
  const teams = (await (await page.request.get('/api/v1/w/demo/teams')).json()).items as { id: string; name: string }[];
  const home = teams.find((t) => t.id !== team.id)!;
  const mk = async (team_id: string, title: string) => {
    const r = await page.request.post('/api/v1/w/demo/issues', { data: { team_id, title } });
    expect(r.status()).toBe(201);
    return (await r.json()) as { id: string; identifier: string };
  };
  await mk(team.id, `Scope other ${key}`);
  const mine = await mk(home.id, `Scope home ${key}`);
  try {
    await page.goto('/');
    await page.waitForSelector('html[data-ready]');
    const nav = page.getByRole('navigation', { name: 'Teams' });
    await expect(nav.getByRole('button', { name: team.name })).toBeVisible();
    await expect(page.getByText(`Scope home ${key}`).first()).toBeVisible();
    await expect(page.getByText(`Scope other ${key}`)).toHaveCount(0);
    const link = nav.locator(`#team-nav-${team.id}`).getByRole('link', { name: 'Issues' });
    await link.click();
    await expect(page.getByText(`Scope other ${key}`).first()).toBeVisible();
    await expect(page.getByText(`Scope home ${key}`)).toHaveCount(0);
    await expect(link).toHaveAttribute('aria-current', 'page');

    await page.goto(`/w/demo/issue/${mine.identifier}`);
    const crumb = page.getByLabel('Breadcrumb');
    await expect(crumb).toContainText(home.name);
    await expect(crumb).toContainText(mine.identifier);
    await expect(crumb).not.toContainText('Issues');
    await expect(page.locator('.idp-head .idh-status')).toHaveCount(0);

    await page.goto('/');
    await page.waitForSelector('html[data-ready]');
    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette')).toBeVisible();
    await expect(page.locator('.palette-foot')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.goto('/w/demo/settings');
    const card = page.locator('section.set-team', { has: page.getByRole('heading', { name: new RegExp(team.name) }) });
    await expect(card.locator('.set-card-head').getByRole('button')).toHaveCount(0);
    await expect(card.locator('.set-danger').getByRole('button', { name: `Delete team ${team.name}` })).toHaveText('Delete team');
  } finally {
    await page.request.delete(`/api/v1/w/demo/teams/${team.id}`).catch(() => undefined);
  }
});

// Team scope has no UI fallback, so the API contract (team_id always returned) is pinned here.
test('API always returns team_id; New issue is created in the displayed team', async ({ page }) => {
  const key = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  const made = await page.request.post('/api/v1/w/demo/teams', { data: { name: 'Newis ' + key, key } });
  expect(made.status()).toBe(201);
  const team = (await made.json()) as { id: string; name: string };
  try {
    const c = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: team.id, title: 'Contract ' + key } });
    expect(c.status()).toBe(201);
    const row = (await c.json()) as { id: string; team_id?: string };
    expect(row.team_id).toBe(team.id);
    const one = (await (await page.request.get('/api/v1/w/demo/issues/' + row.id)).json()) as { team_id?: string };
    expect(one.team_id).toBe(team.id);
    const list = (await (await page.request.get('/api/v1/w/demo/issues?limit=100')).json()).items as { team_id?: string }[];
    expect(list.length).toBeGreaterThan(0);
    for (const i of list) expect(typeof i.team_id).toBe('string');
    await page.goto('/');
    await page.waitForSelector('html[data-ready]');
    await page.getByRole('navigation', { name: 'Teams' }).locator('#team-nav-' + team.id).getByRole('link', { name: 'Issues' }).click();
    await page.keyboard.press('c');
    const dlg = page.getByRole('dialog', { name: /new issue/i });
    await expect(dlg.getByRole('button', { name: team.name + ' team' })).toBeVisible();
    await dlg.getByPlaceholder(/title/i).fill('Created in ' + key);
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText('Created in ' + key).first()).toBeVisible();
  } finally {
    await page.request.delete('/api/v1/w/demo/teams/' + team.id).catch(() => undefined);
  }
});
