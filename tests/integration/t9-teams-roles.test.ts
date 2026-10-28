// Area 9 part 1: workspace settings, team CRUD, team roles admin/member/guest (RLS + API), one assertion block per role.
import { describe, it, expect, beforeAll } from 'vitest';
import { inWs, api, world, appPool } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
beforeAll(async () => {
  if (!runIntegration) return;
  W = await world();
  // M2 joins team ENG as a team guest (read-only); M1 is already an ENG member.
  expect((await api(W.A1, 'POST', `${P}/teams/${W.t1}/members/${W.M2.id}`, { role: 'guest' })).status).toBe(201);
});
/** Run SQL as app_user with the session settings the app would set. */
async function asApp<T>(ws: string, uid: string, f: (q: (s: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const c = await appPool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)", [ws, uid]);
    return await f((s, v) => c.query(s, v as unknown[]));
  } finally { await c.query('rollback'); c.release(); }
}

describe.runIf(runIntegration)('T9 workspace settings', () => {
  it('member reads, cannot update (403)', async () => {
    const r = await api(W.M1, 'GET', `${P}/settings`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ slug: 'w1', role: 'member', logo_url: null });
    expect((await api(W.M1, 'PATCH', `${P}/settings`, { name: 'hax' })).status).toBe(403);
  });
  it('admin updates name + logo, rejects non-https logo, clears logo', async () => {
    expect((await api(W.A1, 'PATCH', `${P}/settings`, { logo_url: 'http://x.test/l.png' })).status).toBe(422);
    const r = await api(W.A1, 'PATCH', `${P}/settings`, { name: 'Renamed', logo_url: 'https://x.test/l.png' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ name: 'Renamed', logo_url: 'https://x.test/l.png' });
    expect(await (await api(W.A1, 'PATCH', `${P}/settings`, { logo_url: '' })).json()).toMatchObject({ logo_url: null });
  });
  it('slug collision with another workspace is 409', async () => {
    expect((await api(W.A1, 'PATCH', `${P}/settings`, { slug: 'w2' })).status).toBe(409);
  });
  it('non-member gets 404', async () => {
    expect((await api(W.B1, 'GET', `${P}/settings`)).status).toBe(404);
  });
  it('app_user cannot call update_workspace_settings as a member (42501)', async () => {
    await expect(asApp(W.w1, W.M1.id, (q) => q("select * from update_workspace_settings('x', null, null)"))).rejects.toMatchObject({ code: '42501' });
  });
});

describe.runIf(runIntegration)('T9 teams CRUD', () => {
  it('admin creates a team and becomes its admin; member cannot create', async () => {
    expect((await api(W.M1, 'POST', `${P}/teams`, { name: 'X', key: 'XX' })).status).toBe(403);
    const r = await api(W.A1, 'POST', `${P}/teams`, { name: 'Design', key: 'DES' });
    expect(r.status).toBe(201);
    const t = await r.json();
    const m = await (await api(W.A1, 'GET', `${P}/teams/${t.id}/members`)).json();
    expect(m.items).toEqual([expect.objectContaining({ user_id: W.A1.id, role: 'admin' })]);
    expect((await api(W.A1, 'PATCH', `${P}/teams/${t.id}`, { name: 'Design 2' })).status).toBe(200);
    expect((await api(W.A1, 'DELETE', `${P}/teams/${t.id}`)).status).toBe(204);
  });
  it('duplicate key in a workspace is 409', async () => {
    expect((await api(W.A1, 'POST', `${P}/teams`, { name: 'Dup', key: 'ENG' })).status).toBe(409);
  });
});

describe.runIf(runIntegration)('T9 team roles', () => {
  it('team guest (M2) reads ENG issues but cannot create/update/delete (403)', async () => {
    expect((await api(W.M2, 'GET', `${P}/issues/${W.i1}`)).status).toBe(200);
    expect((await api(W.M2, 'POST', `${P}/issues`, { title: 'g', team_id: W.t1 })).status).toBe(403);
    expect((await api(W.M2, 'PATCH', `${P}/issues/${W.i1}`, { title: 'g' }, { 'if-match': '1' })).status).toBe(403);
    expect((await api(W.M2, 'DELETE', `${P}/issues/${W.i1}`, undefined, { 'if-match': '1' })).status).toBe(403);
  });
  it('RLS alone blocks a team guest write even if the API check were skipped', async () => {
    await expect(asApp(W.w1, W.M2.id, (q) => q("update issues set title = 'rls' where id = $1", [W.i1]))).rejects.toMatchObject({ code: '42501' });
    await expect(asApp(W.w1, W.M2.id, (q) => q("insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values (gen_random_uuid(), $1, $2, 9999, 'x', 'z', $3)", [W.w1, W.t1, W.M2.id]))).rejects.toMatchObject({ code: '42501' });
  });
  it('team member (M1) writes; cannot manage team membership (403)', async () => {
    const r = await api(W.M1, 'POST', `${P}/issues`, { title: 'member write', team_id: W.t1 });
    expect(r.status).toBe(201);
    expect((await api(W.M1, 'PATCH', `${P}/teams/${W.t1}/members/${W.M2.id}`, { role: 'member' })).status).toBe(403);
    expect((await api(W.M1, 'PATCH', `${P}/teams/${W.t1}`, { name: 'x' })).status).toBe(403);
  });
  it('RLS blocks a team member from changing roles directly', async () => {
    await expect(asApp(W.w1, W.M1.id, (q) => q("update team_memberships set role = 'admin' where team_id = $1 and user_id = $2", [W.t1, W.M1.id]))).rejects.toMatchObject({ code: '42501' });
  });
  it('team admin (promoted M1) manages members without being a workspace admin', async () => {
    expect((await api(W.A1, 'PATCH', `${P}/teams/${W.t1}/members/${W.M1.id}`, { role: 'admin' })).status).toBe(200);
    expect((await api(W.M1, 'PATCH', `${P}/teams/${W.t1}/members/${W.M2.id}`, { role: 'member' })).status).toBe(200);
    expect((await api(W.M2, 'POST', `${P}/issues`, { title: 'now member', team_id: W.t1 })).status).toBe(201);
    expect((await api(W.M1, 'PATCH', `${P}/teams/${W.t1}/members/${W.M2.id}`, { role: 'guest' })).status).toBe(200);
    // M1 is now the only ENG team admin (seed rows default to member): cannot demote themselves
    expect((await api(W.M1, 'PATCH', `${P}/teams/${W.t1}/members/${W.M1.id}`, { role: 'member' })).status).toBe(409);
  });
  it('workspace guest can only be a team guest (422)', async () => {
    expect((await api(W.A1, 'POST', `${P}/teams/${W.t2w1}/members/${W.G1id}`, { role: 'member' })).status).toBe(422);
    expect((await api(W.A1, 'POST', `${P}/teams/${W.t2w1}/members/${W.G1id}`)).status).toBe(201);
    const m = await (await api(W.A1, 'GET', `${P}/teams/${W.t2w1}/members`)).json();
    expect(m.items).toEqual([expect.objectContaining({ user_id: W.G1id, role: 'guest' })]);
  });
  it('has_team_role: helper truth table', async () => {
    const r = await asApp(W.w1, W.M2.id, async (q) => (await q("select has_team_role($1,'guest') g, has_team_role($1,'member') m, has_team_role($1,'bogus') b, has_team_role($2,'guest') other", [W.t1, W.t2w1])).rows[0]);
    expect(r).toEqual({ g: true, m: false, b: false, other: false });
    const a = await asApp(W.w1, W.A1.id, async (q) => (await q('select is_workspace_admin($1) a, is_workspace_admin($2) foreign_ws', [W.w1, W.w2])).rows[0]);
    expect(a).toEqual({ a: true, foreign_ws: false });
  });
  it('anyone may leave a team', async () => {
    expect((await api(W.M2, 'DELETE', `${P}/teams/${W.t1}/members/${W.M2.id}`)).status).toBe(204);
    await inWs(W.w1, (c) => c.query('select 1')); // owner pool still healthy
  });
});
