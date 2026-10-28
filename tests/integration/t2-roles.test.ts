import { describe, it, expect, beforeAll } from 'vitest';
import { ownerPool, api, world, type U } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P1 = '/api/v1/w/w1';
const mk = async (u: U | null, title = 't2') => (await (await api(u, 'POST', `${P1}/issues`, { title, team_id: W.t1 })).json()).id as string;

describe.runIf(runIntegration)('T2 team scoping', () => {
  it('M2 on a T1 issue: 404 on read, no write', async () => {
    const id = await mk(W.M1, 'orig');
    expect((await api(W.M2, 'GET', `${P1}/issues/${id}`)).status).toBe(404);
    expect((await api(W.M2, 'PATCH', `${P1}/issues/${id}`, { title: 'hax' }, { 'if-match': '1' })).status).toBe(404);
    expect((await api(W.M2, 'DELETE', `${P1}/issues/${id}`)).status).toBe(404);
    const t = (await ownerPool.query('select title, deleted_at from issues where id=$1', [id])).rows[0];
    expect(t.title).toBe('orig');
    expect(t.deleted_at).toBeNull();
  });
  it.each(['issues', 'projects', 'cycles'])('M2 list %s?team_id=T1 shows nothing from T1', async (kind) => {
    const r = await api(W.M2, 'GET', `${P1}/${kind}?team_id=${W.t1}`);
    expect([200, 404]).toContain(r.status);
    if (r.status === 200) expect((await r.json()).items).toEqual([]);
  });
  it('M1 has full CRUD in own team', async () => {
    const c = await api(W.M1, 'POST', `${P1}/issues`, { title: 'crud', team_id: W.t1 });
    expect(c.status).toBe(201);
    const { id } = await c.json();
    expect((await api(W.M1, 'GET', `${P1}/issues/${id}`)).status).toBe(200);
    expect((await api(W.M1, 'PATCH', `${P1}/issues/${id}`, { title: 'crud2' }, { 'if-match': '1' })).status).toBe(200);
    expect([200, 204]).toContain((await api(W.M1, 'DELETE', `${P1}/issues/${id}`)).status);
  });
  it('M1 cannot create an issue in T2 (not visible -> 404)', async () => {
    const r = await api(W.M1, 'POST', `${P1}/issues`, { title: 'x', team_id: W.t2w1 });
    expect([403, 404, 422]).toContain(r.status);
  });
});

describe.runIf(runIntegration)('T2 labels', () => {
  it('members apply labels, cannot create or edit (403)', async () => {
    const lid = (await ownerPool.query('select id from labels where workspace_id=$1 limit 1', [W.w1])).rows[0].id;
    const id = await mk(W.M1);
    expect((await api(W.M1, 'PATCH', `${P1}/issues/${id}`, { label_ids: [lid] }, { 'if-match': '1' })).status).toBe(200);
    expect((await api(W.M1, 'POST', `${P1}/labels`, { name: 'new' })).status).toBe(403);
    expect((await api(W.M1, 'PATCH', `${P1}/labels/${lid}`, { name: 'edit' })).status).toBe(403);
    expect((await api(W.A1, 'POST', `${P1}/labels`, { name: 'adm-' + Date.now() })).status).toBe(201);
  });
});

describe.runIf(runIntegration)('T2 guest G1', () => {
  it('reads and comments I1 only', async () => {
    expect((await api(W.G1, 'GET', `${P1}/issues/${W.i1}`)).status).toBe(200);
    expect((await api(W.G1, 'POST', `${P1}/issues/${W.i1}/comments`, { body: 'g' })).status).toBe(201);
  });
  it('I2 is 404 in get, list, search, notifications, sync', async () => {
    expect((await api(W.G1, 'GET', `${P1}/issues/${W.i2}`)).status).toBe(404);
    for (const p of ['/issues', '/search?q=I2', '/notifications']) {
      const r = await api(W.G1, 'GET', P1 + p);
      expect([200, 404]).toContain(r.status);
      expect(await r.text()).not.toContain(W.i2);
    }
    const s = await api(W.G1, 'GET', `${P1}/sync?since=0`);
    if (s.status === 200) {
      const chunk = await Promise.race([s.body!.getReader().read(), new Promise((r) => setTimeout(() => r(null), 1500))]);
      expect(JSON.stringify(chunk)).not.toContain(W.i2);
    }
  });
  it('cannot create issues and cannot share', async () => {
    expect((await api(W.G1, 'POST', `${P1}/issues`, { title: 'g', team_id: W.t1 })).status).toBe(403);
    expect([403, 404]).toContain((await api(W.G1, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: W.G1id })).status);
  });
});

describe.runIf(runIntegration)('T2 share / revoke', () => {
  const guestId = async () => (await ownerPool.query('select guest_user_id id from issue_shares where issue_id=$1 limit 1', [W.i1])).rows[0].id;
  it('A1 and T1 member can share and revoke', async () => {
    const g = await guestId();
    for (const u of [W.A1, W.M1]) {
      const r = await api(u, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: g });
      expect([200, 201, 409]).toContain(r.status);
      expect([200, 204]).toContain((await api(u, 'DELETE', `${P1}/issues/${W.i1}/shares/${g}`)).status);
      await api(W.A1, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: g });
    }
  });
  it('M2 and guest get 404 or 403', async () => {
    const g = await guestId();
    for (const u of [W.M2, W.G1]) {
      expect([403, 404]).toContain((await api(u, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: g })).status);
      expect([403, 404]).toContain((await api(u, 'DELETE', `${P1}/issues/${W.i1}/shares/${g}`)).status);
    }
  });
});

describe.runIf(runIntegration)('T2 admin-only actions', () => {
  const uid = async (team: string) => (await ownerPool.query('select user_id id from team_memberships where team_id=$1 limit 1', [team])).rows[0].id;
  it('role change and removal: member 403, admin ok', async () => {
    const m2 = await uid(W.t2w1);
    expect((await api(W.M1, 'PATCH', `${P1}/members/${m2}`, { role: 'admin' })).status).toBe(403);
    expect((await api(W.M1, 'DELETE', `${P1}/members/${m2}`)).status).toBe(403);
    expect([200, 204]).toContain((await api(W.A1, 'PATCH', `${P1}/members/${m2}`, { role: 'member' })).status);
  });
  it('removing or demoting the last admin is blocked', async () => {
    const a = (await ownerPool.query(`select user_id id from memberships where workspace_id=$1 and role='admin'`, [W.w1])).rows;
    expect(a.length).toBe(1);
    expect([409, 422]).toContain((await api(W.A1, 'DELETE', `${P1}/members/${a[0].id}`)).status);
    expect([409, 422]).toContain((await api(W.A1, 'PATCH', `${P1}/members/${a[0].id}`, { role: 'member' })).status);
  });
  it('audit GET: admin 200, member 403, guest 404', async () => {
    expect((await api(W.A1, 'GET', `${P1}/audit`)).status).toBe(200);
    expect((await api(W.M1, 'GET', `${P1}/audit`)).status).toBe(403);
    expect((await api(W.G1, 'GET', `${P1}/audit`)).status).toBe(404);
  });
  it.todo('route table: every registered route has a role row (needs the single route list export)');
});
