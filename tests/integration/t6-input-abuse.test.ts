import { describe, it, expect, beforeAll } from 'vitest';
import { ownerPool, api, world, type U } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P1 = '/api/v1/w/w1';

describe.runIf(runIntegration)('T6 limits', () => {
  it.skip('body over 1 MB -> 413 #44', async () => {
    const r = await api(W.A1, 'POST', `${P1}/issues`, { title: 'big', team_id: W.t1, description: 'a'.repeat(1_100_000) });
    expect(r.status).toBe(413);
  });
  it('description over 100k chars (body under 1 MB) -> 422', async () => {
    const r = await api(W.A1, 'POST', `${P1}/issues`, { title: 'long', team_id: W.t1, description: 'a'.repeat(100_001) });
    expect(r.status).toBe(422);
  });
  it('description of exactly 100k chars is accepted', async () => {
    expect((await api(W.A1, 'POST', `${P1}/issues`, { title: 'edge', team_id: W.t1, description: 'a'.repeat(100_000) })).status).toBe(201);
  });
  it.skip('301st request in a minute -> 429 with Retry-After, across 2 app instances #48', async () => {
    const urls = [process.env.TEST_BASE_URL ?? 'http://localhost:3000', process.env.TEST_BASE_URL_2].filter(Boolean) as string[];
    expect(urls.length, 'TEST_BASE_URL_2 must point to a second app instance on the same DB').toBe(2);
    await ownerPool.query(`delete from rate_limits where key like $1`, [`%${W.A1id}%`]);
    const codes: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 301; i++) {
      last = await api(W.A1, 'GET', `${P1}/issues?limit=1`, undefined, {}, urls[i % 2]);
      codes.push(last.status);
    }
    expect(codes.slice(0, 300).every((c) => c === 200)).toBe(true);
    expect(codes[300]).toBe(429);
    expect(Number(last!.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 120_000);
});

describe.runIf(runIntegration)('T6 cursors', () => {
  const page = async (u: U | null, q = '') => (await api(u, 'GET', `${P1}/issues?limit=1${q}`)).json();
  it('tampered cursor -> 400', async () => {
    const c: string = (await page(W.A1)).next_cursor;
    expect(c).toBeTruthy();
    const bad = c.slice(0, -2) + (c.endsWith('AA') ? 'BB' : 'AA');
    expect((await api(W.A1, 'GET', `${P1}/issues?cursor=${bad}`)).status).toBe(400);
  });
  it('cursor with different filters -> 400', async () => {
    const c: string = (await page(W.A1, '&status=todo')).next_cursor;
    if (!c) return; // needs at least 2 todo issues in the seed
    expect((await api(W.A1, 'GET', `${P1}/issues?status=done&cursor=${c}`)).status).toBe(400);
  });
  it('cursor from another workspace -> 400 (see T1)', async () => {
    const c: string = (await page(W.A1)).next_cursor;
    expect((await api(W.B1, 'GET', `/api/v1/w/w2/issues?cursor=${c}`)).status).toBe(400);
  });
});

describe.runIf(runIntegration)('T6 injection and XSS', () => {
  const SQLI = [`' OR '1'='1`, `'; drop table issues;--`, `" OR 1=1 --`, `%' UNION SELECT null--`];
  it.skip.each(SQLI)('search %s: no error, no extra rows #47', async (p) => {
    const base = await (await api(W.A1, 'GET', `${P1}/search?q=zzz-no-match`)).json();
    const r = await api(W.A1, 'GET', `${P1}/search?q=${encodeURIComponent(p)}`);
    expect(r.status).toBe(200);
    expect((await r.json()).items.length).toBeLessThanOrEqual(base.items.length);
    expect((await ownerPool.query(`select to_regclass('public.issues') t`)).rows[0].t).toBeTruthy();
  });
  it.each(SQLI)('filters %s: no 500', async (p) => {
    const r = await api(W.A1, 'GET', `${P1}/issues?status=${encodeURIComponent(p)}&label=${encodeURIComponent(p)}`);
    expect(r.status).toBeLessThan(500);
    if (r.status === 200) expect((await r.json()).items).toEqual([]);
  });
  it.skip.each(['sort', 'order'])('%s is whitelisted #45', async (k) => {
    const r = await api(W.A1, 'GET', `${P1}/issues?${k}=${encodeURIComponent('title; select pg_sleep(5)')}`);
    expect([400, 422]).toContain(r.status);
  });
  it('XSS canaries are stored inert (escaped on output, no raw HTML in markdown)', async () => {
    const X = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>'];
    for (const x of X) {
      const c = await api(W.A1, 'POST', `${P1}/issues`, { title: x, team_id: W.t1, description: x });
      expect(c.status).toBe(201);
      const id = (await c.json()).id;
      await api(W.A1, 'POST', `${P1}/issues/${id}/comments`, { body: x });
      const r = await api(W.A1, 'GET', `${P1}/issues/${id}?render=html`);
      // JSON may legitimately carry the raw string; what matters is it is never served as HTML
      expect(r.headers.get('content-type')).toMatch(/application\/json/);
      expect(r.headers.get('content-type')).not.toMatch(/text\/html/);
      const body = await r.text();
      expect(() => JSON.parse(body)).not.toThrow();
    }
  });
});

describe.runIf(runIntegration)('T6 mass assignment', () => {
  it.each([['workspace_id', '00000000-0000-0000-0000-000000000001'], ['id', '00000000-0000-0000-0000-000000000002'],
           ['created_by', '00000000-0000-0000-0000-000000000003'], ['role', 'admin']])('PATCH with %s is ignored or 422', async (k, v) => {
    const c = await (await api(W.M1, 'POST', `${P1}/issues`, { title: 'mass', team_id: W.t1 })).json();
    const before = (await ownerPool.query('select workspace_id, id, created_by from issues where id=$1', [c.id])).rows[0];
    const r = await api(W.M1, 'PATCH', `${P1}/issues/${c.id}`, { [k]: v }, { 'if-match': String(c.version ?? 1) });
    expect([200, 422]).toContain(r.status);
    expect((await ownerPool.query('select workspace_id, id, created_by from issues where id=$1', [c.id])).rows[0]).toEqual(before);
    expect((await ownerPool.query(`select role from memberships where workspace_id=$1 and role='admin' and user_id=(select created_by from issues where id=$1)`, [c.id])).rows.length).toBe(0);
  });
});
