import { test, expect } from '@playwright/test';
import { API_MODE, DEMO } from './helpers/auth';

test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

test('New issue: estimate, due date and an attached link are saved with the issue', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('c');
  const d = page.getByRole('dialog', { name: 'New issue' });
  const title = `more-props-${Date.now()}`;
  await d.getByRole('textbox', { name: 'Issue title' }).fill(title);
  const props = d.getByRole('group', { name: 'Properties' });
  await props.getByRole('button', { name: 'More properties' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^Estimate$/ }).click();
  await page.locator('.combo-opt').filter({ hasText: /^3 pts$/ }).click();
  await props.getByRole('button', { name: 'More properties' }).click();
  await page.locator('.combo-opt').filter({ hasText: /^Due date$/ }).click();
  await expect(props.getByLabel('Due date')).toBeFocused();
  await props.getByLabel('Due date').fill('2026-12-24');
  await d.getByRole('button', { name: 'Attach link' }).click();
  await d.getByLabel('Link URL').fill('https://example.com/brief');
  await d.getByLabel('Link title').fill('Brief');
  await d.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.keyboard.press('Control+Enter');
  await expect(d).toBeHidden();
  const q = await page.request.get(`/api/v1/w/${DEMO.slug}/issues?q=${encodeURIComponent(title)}&team_id=${DEMO.teamId}`);
  const row = (await q.json()).items.find((i: { title: string }) => i.title === title);
  expect(row.estimate).toBe(3);
  expect(row.due_date).toBe('2026-12-24');
  const a = await page.request.get(`/api/v1/w/${DEMO.slug}/issues/${row.id}/attachments`);
  expect((await a.json()).items.map((x: { title: string }) => x.title)).toEqual(['Brief']);
});
