import { test, expect } from '@playwright/test';

test('CSP blocks injected inline script (eval is asserted via header: evaluate() bypasses CSP); app scripts still run', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  const res = await page.goto('/');
  const csp = res!.headers()['content-security-policy'];
  expect(csp).toContain(`object-src 'none'`);
  expect(csp).not.toContain(`'unsafe-inline'`);
  expect(csp).not.toContain(`'unsafe-eval'`);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
  const r = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__pwned = false;
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = true';
    document.body.appendChild(s);
    return { pwned: w.__pwned };
  });
  expect(r.pwned).toBe(false);
  await page.waitForTimeout(300);
  expect(violations.join('\n')).toMatch(/script-src/);
});
