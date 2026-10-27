// @ts-nocheck TODO(M1): black-box suite drafted before the M1 routes exist; remove once typed against the real API.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment -- TODO(M1) draft suite */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { runIntegration } from '../integration/helpers/gate';
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ci = () => readdirSync('.github/workflows').map((f) => readFileSync(join('.github/workflows', f), 'utf8')).join('\n');

describe('S9 dependencies', () => {
  it('CI audits prod deps at high', () => expect(ci()).toMatch(/pnpm audit --prod --audit-level=high/));
  it('CI installs with --frozen-lockfile and lockfile is committed', () => {
    expect(ci()).toMatch(/--frozen-lockfile/);
    expect(execSync('git ls-files pnpm-lock.yaml').toString().trim()).toBe('pnpm-lock.yaml');
  });
  it('gitleaks runs in CI', () => expect(ci()).toMatch(/gitleaks/i));
  it('weekly dependency updates configured', () => {
    const f = ['.github/dependabot.yml', 'renovate.json', '.github/renovate.json'].find(existsSync);
    expect(f, 'dependabot or renovate config').toBeTruthy();
    expect(readFileSync(f!, 'utf8')).toMatch(/weekly|before .* on monday/i);
  });
  it('no install scripts from new packages (pnpm onlyBuiltDependencies allowlist present)', () => {
    expect(readFileSync('package.json', 'utf8')).toMatch(/onlyBuiltDependencies|ignoredBuiltDependencies/);
  });
});

describe.runIf(runIntegration)('S10 headers', () => {
  const need = async (path: string) => {
    const h = (await fetch(BASE + path, { headers: { accept: path.includes('sync') ? 'text/event-stream' : '*/*' } })).headers;
    const csp = h.get('content-security-policy') ?? '';
    expect(csp).toMatch(/default-src 'self'/);
    const script = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toMatch(/frame-ancestors 'none'/); expect(csp).toMatch(/base-uri 'self'/); expect(csp).toMatch(/form-action 'self'/);
    expect(Number(/max-age=(\d+)/.exec(h.get('strict-transport-security') ?? '')?.[1])).toBeGreaterThanOrEqual(31536000);
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('permissions-policy')).toBeTruthy();
  };
  it.each(['/', '/api/v1/me', '/api/v1/w/w1/sync?since=now'])('%s sends the full header set', need);
  it('markdown sanitizer strips raw HTML', async () => {
    const { renderMarkdown } = await import('../../src/lib/markdown'); // adjust path
    for (const p of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))'])
      expect(renderMarkdown(p)).not.toMatch(/<script|onerror|javascript:/i);
  });
});

describe('S11 logs and errors', () => {
  it('audit redaction unit: password, token, secret, hash keys are redacted', async () => {
    const { redact } = await import('../../src/lib/audit'); // adjust path
    const out = JSON.stringify(redact({ password: 'p', new_password: 'p', token: 't', api_secret: 's', password_hash: 'h', token_hash: 'h', title: 'ok', nested: { secret: 's' } }));
    expect(out).not.toMatch(/"p"|"t"|"s"|"h"/); expect(out).toContain('ok');
  });
  it.runIf(runIntegration)('error bodies have no stack, SQL or constraint names', async () => {
    for (const [m, p, b] of [['GET', '/api/v1/w/nope/issues', undefined], ['POST', '/api/v1/auth/login', '{bad json'], ['GET', '/api/v1/w/w1/issues/not-a-uuid', undefined]] as const) {
      const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', origin: BASE }, body: b });
      const t = await r.text();
      expect(t).not.toMatch(/\bat \S+ \(|node_modules|select .* from|violates|_pkey|_fkey|_key"|syntax error/i);
      expect(JSON.parse(t).error.request_id ?? JSON.parse(t).request_id).toBeTruthy();
    }
  });
  // TODO: needs tests/integration/helpers/log-capture.ts (wraps the app logger in the test server).
  it.skip('logger capture: sentinel never reaches logs', async () => {
    const { captureLogs } = await import('../integration/helpers/log-capture');
    const C = 'PII_CANARY_123';
    const logs = await captureLogs(async () => {
      const h = { 'content-type': 'application/json', origin: BASE };
      await fetch(BASE + '/api/v1/auth/signup', { method: 'POST', headers: h, body: JSON.stringify({ email: `${C}@example.test`, password: `${C}-long-password`, name: C }) });
      await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { ...h, authorization: `Bearer ${C}`, cookie: `x=${C}` }, body: JSON.stringify({ email: `${C}@example.test`, password: C }) });
      await fetch(BASE + '/api/v1/w/w1/issues', { method: 'POST', headers: { ...h, cookie: `x=${C}` }, body: JSON.stringify({ title: C, description: C }) });
      await fetch(BASE + '/api/v1/invites/accept', { method: 'POST', headers: h, body: JSON.stringify({ token: C }) });
    });
    expect(logs).not.toContain(C);
  });
});

describe.runIf(runIntegration)('S12 migrations', () => {
  const owner = () => new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  it('exempt allowlist is exactly the Appendix A set (+ rate_limits, signed off by Rex)', () => {
    const f = ['db/rls-exempt-allowlist.txt'].find(existsSync);
    expect(f).toBeTruthy();
    const list = readFileSync(f!, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).sort();
    expect(list).toEqual(['email_verifications', 'password_resets', 'rate_limits', 'sessions', 'users']);
  });
  it('every workspace_id table: NOT NULL, FK, index leading with workspace_id, FORCE RLS, policy with USING and WITH CHECK', async () => {
    const p = owner();
    const t = (await p.query(`select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='workspace_id' and not a.attisdropped where c.relkind='r' and c.relnamespace='public'::regnamespace`)).rows;
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) {
      expect(x.relrowsecurity && x.relforcerowsecurity, x.relname + ' FORCE RLS').toBe(true);
      const nn = (await p.query(`select attnotnull from pg_attribute where attrelid=$1 and attname='workspace_id'`, [x.oid])).rows[0].attnotnull;
      expect(nn, x.relname + ' NOT NULL').toBe(true);
      expect((await p.query(`select 1 from pg_constraint where conrelid=$1 and contype='f' and conkey @> array[(select attnum from pg_attribute where attrelid=$1 and attname='workspace_id')]`, [x.oid])).rowCount, x.relname + ' FK').toBeGreaterThan(0);
      expect((await p.query(`select 1 from pg_index i where i.indrelid=$1 and i.indkey[0]=(select attnum from pg_attribute where attrelid=$1 and attname='workspace_id')`, [x.oid])).rowCount, x.relname + ' index').toBeGreaterThan(0);
      const pol = (await p.query(`select qual, with_check from pg_policies where tablename=$1`, [x.relname])).rows;
      expect(pol.length, x.relname + ' policy').toBeGreaterThan(0);
      for (const o of pol) { expect(o.qual).toMatch(/current_setting\('app\.workspace_id'(, true)?\)/); expect(o.with_check).toMatch(/app\.workspace_id/); }
    }
    await p.end();
  });
  it('app_user: no superuser, no BYPASSRLS, owns nothing, no DDL', async () => {
    const p = owner();
    expect((await p.query(`select rolsuper, rolbypassrls from pg_roles where rolname='app_user'`)).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await p.query(`select count(*)::int n from pg_class where relowner=(select oid from pg_roles where rolname='app_user')`)).rows[0].n).toBe(0);
    expect((await p.query(`select has_schema_privilege('app_user','public','CREATE') c`)).rows[0].c).toBe(false);
    await p.end();
  });
  it('SECURITY DEFINER functions: pinned search_path, EXECUTE only app_user', async () => {
    const p = owner();
    const fns = (await p.query(`select p.oid, p.proname, p.proconfig from pg_proc p where p.prosecdef and p.pronamespace='public'::regnamespace`)).rows;
    for (const f of fns) {
      expect((f.proconfig ?? []).join(), f.proname).toMatch(/search_path=pg_catalog, public/);
      expect((await p.query(`select has_function_privilege('public', $1::oid, 'EXECUTE') x`, [f.oid])).rows[0].x, f.proname + ' public EXECUTE').toBe(false);
      expect((await p.query(`select has_function_privilege('app_user', $1::oid, 'EXECUTE') x`, [f.oid])).rows[0].x, f.proname + ' app_user').toBe(true);
    }
    await p.end();
  });
  it('every migration PR notes a reversal plan', () => {
    expect(readFileSync('.github/pull_request_template.md', 'utf8')).toMatch(/revers/i);
  });
});
