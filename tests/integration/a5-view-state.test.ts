import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerSql, appSql, seedTwoWorkspaces, withWorkspace, type Seed } from '../helpers/seed';
import { setSessionResolver, db } from '../../src/lib/http/ctx';
import * as V from '../../src/lib/resources/views';
import * as S from '../../src/lib/resources/view-state';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');
(haveDb ? describe : describe.skip)('A5: view state and favourites', () => {
  const owner = ownerSql(); let seed: Seed; let teamA = ''; let teamOther = ''; let member2 = '';
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, method: string, body: unknown, ver: number | null, query: string, ...a: string[]) =>
    fn(new Request(`http://x/api${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'x-u': user, 'content-type': 'application/json', ...(ver === null ? {} : { 'if-match': `"${ver}"` }) } }), ...a);
  const slug = () => seed.a.slug;
  const filters = { op: 'and', rules: [{ field: 'status', op: 'in', value: ['todo'] }] };
  const st = (u: string, scope: string, ver: number | null, extra: object = {}) =>
    call(S.putViewState as Fn, u, 'PUT', { scope, layout: 'board', filters, display: { grouping: 'status' }, ...extra }, ver, '', slug());
  const mkView = async (u: string, name: string, extra: object = {}) =>
    (await (await call(V.createView as Fn, u, 'POST', { name, ...extra }, null, '', slug())).json()) as { id: string; version: number };

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get('x-u'));
    teamA = randomUUID(); teamOther = randomUUID(); member2 = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG'), (${teamOther}, ${seed.a.id}, 'Ops', 'OPS')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
      await tx`insert into users (id, email, password_hash, email_verified_at) values (${member2}, ${`m2-${member2}@a.test`}, 'x', now())`;
      await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${seed.a.id}, ${member2}, 'member')`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('defaults, round trip, stale 412, missing 428, guest 403', async () => {
    const g = await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, '?scope=all', slug());
    expect(g.status).toBe(200); expect(await g.json()).toMatchObject({ scope: 'all', layout: 'list', filters: { op: 'and', rules: [] }, display: {}, version: 0 });
    const c = await st(seed.a.member, 'all', 0); expect(c.status).toBe(200); expect((await c.json()).version).toBe(1);
    expect((await st(seed.a.member, 'all', 0)).status).toBe(412);
    expect((await st(seed.a.member, 'all', null)).status).toBe(428);
    const u = await st(seed.a.member, 'all', 1, { layout: 'list' }); expect((await u.json())).toMatchObject({ version: 2, layout: 'list', filters });
    const r = await (await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, '?scope=all', slug())).json();
    expect(r).toMatchObject({ version: 2, display: { grouping: 'status' } });
    expect((await call(S.getViewState as Fn, seed.a.guest, 'GET', undefined, null, '?scope=all', slug())).status).toBe(403);
    expect((await st(seed.a.guest, 'all', 0)).status).toBe(403);
  });

  it('bad scope 422, oversize 422, unknown field 422, invisible scope 404', async () => {
    expect((await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, '?scope=nope', slug())).status).toBe(422);
    expect((await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, `?scope=team:${'z'.repeat(36)}`, slug())).status).toBe(422);
    expect((await call(S.deleteViewState as Fn, seed.a.member, 'DELETE', undefined, null, '', slug())).status).toBe(422);
    expect((await st(seed.a.member, 'my-issues', 0, { extra: 1 })).status).toBe(422);
    const big = { op: 'and', rules: Array.from({ length: 50 }, () => ({ field: 'status', op: 'in', value: Array.from({ length: 100 }, () => 'x'.repeat(200)) })) };
    expect((await st(seed.a.member, 'my-issues', 0, { filters: big })).status).toBe(422);
    expect((await st(seed.a.member, `team:${teamOther}`, 0)).status).toBe(404); // member not in Ops
    expect((await st(seed.a.member, `team:${randomUUID()}`, 0)).status).toBe(404);
    expect((await st(seed.a.member, `project:${randomUUID()}`, 0)).status).toBe(404);
    expect((await st(seed.a.member, `cycle:${randomUUID()}`, 0)).status).toBe(404);
    expect((await st(seed.a.admin, `team:${teamOther}`, 0)).status).toBe(200); // admins see all teams
    expect((await st(seed.a.member, `team:${teamA}`, 0)).status).toBe(200);
  });

  it('view scope follows view visibility; user B never sees A state (RLS); list; reset', async () => {
    const pv = await mkView(seed.a.member, 'private');
    expect((await st(seed.a.member, `view:${pv.id}`, 0)).status).toBe(200);
    expect((await st(member2, `view:${pv.id}`, 0)).status).toBe(404);
    expect((await st(seed.a.admin, `view:${pv.id}`, 0)).status).toBe(404);
    const other = await (await call(S.getViewState as Fn, member2, 'GET', undefined, null, '?scope=all', slug())).json();
    expect(other.version).toBe(0);
    await st(member2, 'all', 0);
    const mine = await (await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, '', slug())).json();
    expect(mine.items.every((i: { scope: string }) => i.scope !== 'x')).toBe(true);
    // raw RLS: as app_user with admin's id, another user's rows are invisible even with the right workspace
    const sql = appSql();
    const count = (uid: string) => withWorkspace(sql, seed.a.id, async (tx) => (await tx`select count(*)::int as n from user_view_state where user_id = ${seed.a.member}`)[0]!.n as number, uid);
    expect(await count(seed.a.member)).toBeGreaterThan(0);
    expect(await count(seed.a.admin)).toBe(0); // even an admin never reads another user's rows
    await sql.end();
    expect((await call(S.deleteViewState as Fn, seed.a.member, 'DELETE', undefined, null, '?scope=all', slug())).status).toBe(204);
    expect((await call(S.deleteViewState as Fn, seed.a.member, 'DELETE', undefined, null, '?scope=all', slug())).status).toBe(204);
    expect((await (await call(S.getViewState as Fn, seed.a.member, 'GET', undefined, null, '?scope=all', slug())).json()).version).toBe(0);
    expect((await st(seed.b.member, 'all', 0)).status).not.toBe(200); // other workspace slug mismatch: not a member of A
  });

  it('two parallel first PUTs: one 200, the other 412 (never 500)', async () => {
    const rs = await Promise.all([st(seed.a.member, 'my-issues', 0), st(seed.a.member, 'my-issues', 0)]);
    const codes = rs.map((r) => r.status).sort();
    expect(codes).toEqual([200, 412]);
    await call(S.deleteViewState as Fn, seed.a.member, 'DELETE', undefined, null, '?scope=my-issues', slug());
  });

  it('deleting a view removes every user view:<id> state', async () => {
    const v = await mkView(seed.a.admin, 'shared-del', { shared: true });
    expect((await st(seed.a.member, `view:${v.id}`, 0)).status).toBe(200);
    expect((await st(member2, `view:${v.id}`, 0)).status).toBe(200);
    expect((await st(seed.a.admin, `view:${v.id}`, 0)).status).toBe(200);
    expect((await call(V.deleteView as Fn, seed.a.admin, 'DELETE', undefined, v.version, '', slug(), v.id)).status).toBe(204);
    const left = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return (await tx`select count(*)::int as n from user_view_state where scope = ${`view:${v.id}`}`)[0]!.n; });
    // owner is FORCE-RLS too (no app.user_id => sees nothing), so also check through each user
    expect(left).toBe(0);
    for (const u of [seed.a.member, member2, seed.a.admin]) {
      const sql = appSql();
      const n = await withWorkspace(sql, seed.a.id, async (tx) => (await tx`select count(*)::int as n from user_view_state where scope = ${`view:${v.id}`}`)[0]!.n as number, u);
      await sql.end(); expect(n).toBe(0);
    }
  });

  it('favorite with malformed or oversized body is 400/422, never 500', async () => {
    const v = await mkView(seed.a.owner, 'badbody');
    const raw = (b: string) => S.putFavorite(new Request('http://x/api', { method: 'PUT', body: b, headers: { 'x-u': seed.a.owner, 'content-type': 'application/json' } }), slug(), v.id);
    expect((await raw('{')).status).toBe(400);
    expect((await raw('not json')).status).toBe(400);
    expect((await raw('x'.repeat(5000))).status).toBe(422);
    const big = await S.putFavorite(new Request('http://x/api', { method: 'PUT', body: '{}', headers: { 'x-u': seed.a.owner, 'content-length': '5000' } }), slug(), v.id);
    expect(big.status).toBe(422);
    expect((await raw('')).status).toBe(200);
  });

  it('favourites: order, idempotent, hidden when view becomes invisible, cap 50, cascade', async () => {
    const f = (u: string, id: string, body?: unknown) => call(S.putFavorite as Fn, u, 'PUT', body, null, '', slug(), id);
    const a = await mkView(seed.a.admin, 'A', { shared: true }), b = await mkView(seed.a.admin, 'B', { shared: true });
    expect((await (await f(seed.a.member, a.id)).json()).position).toBe(0);
    expect((await (await f(seed.a.member, b.id)).json()).position).toBe(1);
    expect((await f(seed.a.member, a.id)).status).toBe(200);
    expect((await (await f(seed.a.member, a.id, { position: 5 })).json()).position).toBe(5);
    expect((await f(seed.a.member, b.id, { position: -1 })).status).toBe(422);
    const lst = async (u: string) => (await (await call(S.listFavorites as Fn, u, 'GET', undefined, null, '', slug())).json()).items as { view_id: string; view: { name: string } }[];
    expect((await lst(seed.a.member)).map((i) => i.view.name)).toEqual(['B', 'A']);
    expect(await lst(member2)).toEqual([]);
    expect((await f(seed.a.member, randomUUID())).status).toBe(404);
    // owner unshares B: it disappears from member's favourites
    expect((await call(V.patchView as Fn, seed.a.admin, 'PATCH', { shared: false }, b.version, '', slug(), b.id)).status).toBe(200);
    expect((await f(seed.a.member, b.id)).status).toBe(404);
    expect((await lst(seed.a.member)).map((i) => i.view.name)).toEqual(['A']);
    // cap
    for (let i = 0; i < 49; i++) { const v = await mkView(seed.a.member, `v${i}`); expect((await f(seed.a.member, v.id)).status).toBe(200); }
    const extra = await mkView(seed.a.member, 'extra');
    expect((await f(seed.a.member, extra.id)).status).toBe(422);
    expect((await f(seed.a.member, a.id)).status).toBe(200); // existing still idempotent at the cap
    // delete + cascade
    expect((await call(S.deleteFavorite as Fn, seed.a.member, 'DELETE', undefined, null, '', slug(), a.id)).status).toBe(204);
    expect((await call(S.deleteFavorite as Fn, seed.a.member, 'DELETE', undefined, null, '', slug(), a.id)).status).toBe(204);
    const v0 = (await lst(seed.a.member))[0]!;
    const full = await (await call(V.getViewH as Fn, seed.a.member, 'GET', undefined, null, '', slug(), v0.view_id)).json();
    expect((await call(V.deleteView as Fn, seed.a.member, 'DELETE', undefined, full.version, '', slug(), v0.view_id)).status).toBe(204);
    const left = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return (await tx`select count(*)::int as n from view_favorites where view_id = ${v0.view_id}`)[0]!.n; });
    expect(left).toBe(0);
  }, 60000);
});
