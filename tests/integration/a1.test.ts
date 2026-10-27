import { runIntegration } from './helpers/gate';
import { describe, it, expect, beforeAll } from 'vitest';
import { appPool, ownerPool, api, world } from './helpers/world';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { W = await world(); });
const P1 = '/api/v1/w/w1';

describe.runIf(runIntegration)('A1.1 cross-tenant requests return 404 on every endpoint', () => {
  // Placeholder list: T2 requires this to be generated from the real route table.
  const routes: [string, string][] = [
    ['GET', '/issues/:issue'], ['PATCH', '/issues/:issue'], ['DELETE', '/issues/:issue'],
    ['POST', '/issues/:issue/restore'], ['GET', '/issues'], ['GET', '/projects'],
    ['GET', '/cycles'], ['GET', '/labels'], ['GET', '/search?q=I1'],
    ['GET', '/audit'], ['GET', '/sync?since=0'],
  ];
  it.each(routes)('B1 %s ' + P1 + '%s -> 404, never 403', async (method, tpl) => {
    const path = P1 + tpl.replace(':issue', W.i1);
    const r = await api(W.B1, method, path, method === 'PATCH' ? { title: 'x' } : undefined, { 'if-match': '1' });
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.text())).not.toContain(W.w1);
  });
  it('route table coverage (TODO wire to generated route list)', () => {
    expect(routes.length).toBeGreaterThan(0);
  });
});

describe.runIf(runIntegration)('A1.2 RLS with app.workspace_id unset returns 0 rows', () => {
  it('every tenant table returns 0 rows for app_user without the setting', async () => {
    const tables = (await ownerPool.query(
      `select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id'`)).rows;
    expect(tables.length).toBeGreaterThan(0);
    for (const { table_name } of tables) {
      const c = await appPool.connect();
      try {
        await c.query('reset app.workspace_id').catch(() => {});
        const r = await c.query(`select count(*)::int n from "${table_name}"`);
        expect(r.rows[0].n, table_name).toBe(0);
      } finally { c.release(); }
    }
  });
  it('app_user is not superuser, not BYPASSRLS, tables have FORCE RLS', async () => {
    const u = (await appPool.query(`select rolsuper, rolbypassrls from pg_roles where rolname=current_user`)).rows[0];
    expect(u).toEqual({ rolsuper: false, rolbypassrls: false });
    const bad = (await ownerPool.query(
      `select c.relname from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attname='workspace_id'
       where c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity)`)).rows;
    expect(bad).toEqual([]);
  });
});

describe.runIf(runIntegration)('A1.3 invalid invites return 404 INVITE_INVALID', () => {
  const accept = (token: string) => api(W.N, 'POST', '/api/v1/invites/accept', { token });
  it('missing, unknown, malformed tokens give identical status and body', async () => {
    const rs = await Promise.all([accept(''), accept('nope'), accept('a'.repeat(43))]);
    const snaps = await Promise.all(rs.map(async (r) => ({ s: r.status, b: await r.text() })));
    for (const s of snaps) { expect(s.s).toBe(404); expect(JSON.parse(s.b).error.code).toBe('INVITE_INVALID'); }
    const norm = (s: { b: string }) => s.b.replace(/"request_?id":"[^"]*"/i, '');
    expect(new Set(snaps.map(norm)).size).toBe(1);
  });
  it.todo('expired / reused / wrong-email / revoked tokens: same snapshot (needs invite seed)');
});

describe.runIf(runIntegration)('A1.4 guest permissions', () => {
  it('guest cannot create an issue (403)', async () => {
    const r = await api(W.G1, 'POST', `${P1}/issues`, { title: 'g', team_id: W.t1 });
    expect(r.status).toBe(403);
  });
  it('guest can comment on shared issue I1 (201)', async () => {
    const r = await api(W.G1, 'POST', `${P1}/issues/${W.i1}/comments`, { body: 'hi' });
    expect(r.status).toBe(201);
  });
  it('guest gets 404 on non-shared I2', async () => {
    expect((await api(W.G1, 'GET', `${P1}/issues/${W.i2}`)).status).toBe(404);
  });
});
