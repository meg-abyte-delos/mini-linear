import { test, expect } from '@playwright/test';
import { API_MODE, DEMO, apiCreateIssue } from './helpers/auth';

// UI review 00:00: Linear composer (plain placeholder, attach + send icons inside the box) and the empty Cmd+K list.
test.skip(!API_MODE || !DEMO.teamId, 'API-mode e2e: needs ML_API=1, ML_TEAM_ID and the demo seed');

test('issue composer: Leave a comment placeholder, attach and send icons inside the box', async ({ page }) => {
  const issue = await apiCreateIssue(page, `composer-${Date.now()}`);
  await page.goto(`/w/${DEMO.slug}/issue/${issue.identifier}`);
  await page.waitForSelector('html[data-ready]');
  const box = page.getByRole('combobox', { name: 'Leave a comment' });
  await expect(box).toHaveAttribute('placeholder', 'Leave a comment…');
  const send = page.getByRole('button', { name: 'Comment', exact: true });
  const attach = page.getByRole('button', { name: 'Attach link' });
  await expect(send).toBeDisabled();
  const b = (await box.boundingBox())!; const s = (await send.boundingBox())!; const a = (await attach.boundingBox())!;
  for (const r of [s, a]) { expect(r.x).toBeGreaterThanOrEqual(b.x); expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 1); expect(r.y).toBeGreaterThanOrEqual(b.y); expect(r.y + r.height).toBeLessThanOrEqual(b.y + b.height + 1); }
  expect(s.x).toBeGreaterThan(a.x);
  await expect(page.getByText('Comment', { exact: true })).toHaveCount(0);
  await box.fill('hello composer');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('article', { name: /Comment by/ }).first()).toContainText('hello composer');
  await attach.click();
  await expect(page.getByLabel('Link URL')).toBeFocused();
});

test('Cmd+K with an empty query: Create issue first, Help group last, one icon per action, no Clear selection', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
  await page.keyboard.press('Control+k');
  const rows = page.locator('[id^=pc-]');
  await expect(rows.first()).toContainText('Create issue');
  await expect(rows.filter({ hasText: 'Clear selection' })).toHaveCount(0);
  await expect(rows.last()).toContainText('Keyboard shortcuts');
  const ids = await rows.evaluateAll((els) => els.map((e) => ({ label: e.querySelector('.pal-label')?.textContent ?? '', d: Array.from(e.querySelectorAll(".pal-ic svg path")).map((p) => p.getAttribute('d')).join('|') })));
  const byLabel = (l: string) => ids.find((x) => x.label.startsWith(l))!.d;
  expect(byLabel('Keyboard shortcuts')).not.toBe(byLabel('Go to issues'));
  expect(byLabel('Go to projects')).not.toBe(byLabel('Go to cycles'));
  for (const l of ['Select / unselect', 'Set status', 'Set priority', 'Set assignee', 'Set label']) expect(byLabel(l), l).not.toContain('M22 12h-6l-2 3h-4');
  expect(new Set([byLabel('Set priority'), byLabel('Set assignee'), byLabel('Set label'), byLabel('Keyboard shortcuts')]).size).toBe(4);
});
