import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { setSessionResolver, db } from '../../src/lib/http/ctx';
import * as V from '../../src/lib/resources/views';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');
(haveDb ? describe : describe.skip)('Area 4: saved views API', () => {
  const owner = ownerSql(); let seed: Seed; let teamA = '';
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, method: string, body: unknown, ver: number | null, ...a: string[]) =>
    fn(new Request('http://x/api', { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'x-u': user, 'content-type': 'application/json', ...(ver === null ? {} : { 'if-match': `"${ver}"` }) } }), ...a);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get('x-u'));
    teamA = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('personal view is private; shared view is visible to members; guests see nothing', async () => {
    const filters = { op: 'and', rules: [{ field: 'status', op: 'in', value: ['todo', 'done'] }, { op: 'or', rules: [{ field: 'priority', op: 'lt', value: 2 }, { field: 'due_date', op: 'within', value: '7d' }] }] };
    const p = await call(V.createView as Fn, seed.a.member, 'POST', { name: 'Mine', filters, display: { grouping: 'status', sub_grouping: 'assignee' } }, null, seed.a.slug);
    expect(p.status).toBe(201); const pv = await p.json(); expect(pv.shared).toBe(false); expect(pv.filters).toEqual(filters);
    const s = await call(V.createView as Fn, seed.a.admin, 'POST', { name: 'Shared', shared: true, layout: 'board' }, null, seed.a.slug);
    expect(s.status).toBe(201); const sv = await s.json();
    const list = await (await call(V.listViews as Fn, seed.a.admin, 'GET', undefined, null, seed.a.slug)).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([sv.id]); // admin does not see member's personal view
    const mlist = await (await call(V.listViews as Fn, seed.a.member, 'GET', undefined, null, seed.a.slug)).json();
    expect(mlist.items.length).toBe(2);
    expect((await call(V.getViewH as Fn, seed.a.admin, 'GET', undefined, null, seed.a.slug, pv.id)).status).toBe(404);
    expect((await call(V.listViews as Fn, seed.a.guest, 'GET', undefined, null, seed.a.slug)).status).toBe(403);
  });

  it('validation: unknown field, same grouping and sub-grouping, bad team', async () => {
    const bad = (b: unknown) => call(V.createView as Fn, seed.a.member, 'POST', b, null, seed.a.slug).then((r) => r.status);
    expect(await bad({ name: 'x', filters: { op: 'and', rules: [{ field: 'nope', op: 'is' }] } })).toBe(422);
    expect(await bad({ name: 'x', display: { grouping: 'status', sub_grouping: 'status' } })).toBe(422);
    expect(await bad({ name: 'x', display: { sub_grouping: 'status' } })).toBe(422);
    expect(await bad({ name: 'x', team_id: randomUUID() })).toBe(422);
    expect(await bad({ name: '' })).toBe(422);
  });

  it('update needs If-Match; only owner (or admin on shared) writes; cross-tenant is 404', async () => {
    const sv = await (await call(V.createView as Fn, seed.a.member, 'POST', { name: 'S2', shared: true, team_id: teamA }, null, seed.a.slug)).json();
    expect((await call(V.patchView as Fn, seed.a.member, 'PATCH', { name: 'n' }, null, seed.a.slug, sv.id)).status).toBe(428);
    expect((await call(V.patchView as Fn, seed.a.member, 'PATCH', { name: 'n' }, 9, seed.a.slug, sv.id)).status).toBe(412);
    const ok = await call(V.patchView as Fn, seed.a.admin, 'PATCH', { name: 'renamed' }, 1, seed.a.slug, sv.id);
    expect(ok.status).toBe(200); expect((await ok.json()).version).toBe(2);
    expect((await call(V.patchView as Fn, seed.a.admin, 'PATCH', { shared: false }, 2, seed.a.slug, sv.id)).status).toBe(403); // only owner flips sharing
    expect((await call(V.getViewH as Fn, seed.b.member, 'GET', undefined, null, seed.b.slug, sv.id)).status).toBe(404);
    expect((await call(V.deleteView as Fn, seed.a.member, 'DELETE', undefined, 2, seed.a.slug, sv.id)).status).toBe(204);
  });
});
