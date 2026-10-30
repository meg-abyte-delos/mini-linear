import { test, expect } from '@playwright/test';

// L6: a parent's list row and board card show done/total over its live sub-issues (API mode, demo workspace).
test('list row and board card show the sub-issue roll-up of a parent', async ({ page }) => {
  const teams = await (await page.request.get('/api/v1/w/demo/teams')).json();
  const mk = async (data: Record<string, unknown>) => {
    const r = await page.request.post('/api/v1/w/demo/issues', { data: { team_id: teams.items[0].id, ...data } });
    expect(r.status()).toBe(201);
    return (await r.json()) as { id: string; identifier: string; version: number };
  };
  const parent = await mk({ title: 'L6 roll-up parent' });
  const a = await mk({ title: 'L6 child done', parent_id: parent.id });
  await mk({ title: 'L6 child open', parent_id: parent.id });
  const done = await page.request.patch(`/api/v1/w/demo/issues/${a.id}`, { data: { status: 'done' }, headers: { 'if-match': String(a.version) } });
  expect(done.ok()).toBe(true);
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  const badge = page.getByTestId(`sub-${parent.identifier}`);
  await expect(badge).toHaveText('1/2');
  await expect(badge.getByRole('img')).toHaveAttribute('aria-label', '1 of 2 sub-issues done');
  await expect(page.getByTestId(`sub-${a.identifier}`)).toHaveCount(0);
});
