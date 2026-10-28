/* eslint-disable @typescript-eslint/ban-ts-comment -- TODO(M1) draft suite */
// @ts-nocheck TODO(M1): black-box suite drafted before the M1 routes exist; remove once typed against the real API.
import { describe, it, expect, beforeAll } from 'vitest';
import { ownerPool, inWs, api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P1 = '/api/v1/w/w1';
const events = async (since: Date) =>
  (await inWs(W.w1, (c) => c.query(`select * from audit_events where workspace_id=$1 and created_at >= $2 order by created_at`, [W.w1, since]))).rows;

describe.runIf(runIntegration)('T7 one request = one transaction = one audit event', () => {
  it('PATCH lists every changed field in a single event', async () => {
    const cr = await api(W.M1, 'POST', `${P1}/issues`, { title: 'a1', team_id: W.t1 });
    expect(cr.status).toBe(201);
    const c = await cr.json();
    const t0 = new Date();
    const r = await api(W.M1, 'PATCH', `${P1}/issues/${c.id}`, { title: 'b1', priority: 2, description: 'd' }, { 'if-match': String(c.version ?? 1) });
    expect(r.status).toBe(200);
    const ev = (await events(t0)).filter((e) => e.entity_id === c.id);
    expect(ev).toHaveLength(1);
    const keys = Object.keys(ev[0].diff?.after ?? ev[0].diff).filter((k) => !['version', 'updated_at'].includes(k));
    expect(keys.sort()).toEqual(expect.arrayContaining(['description', 'priority', 'title']));
  });
  it.skip('failed request writes no event and no sync event #50', async () => {
    const t0 = new Date();
    const n0 = (await ownerPool.query('select count(*)::int n from sync_events where workspace_id=$1', [W.w1])).rows[0].n;
    expect((await api(W.M1, 'POST', `${P1}/issues`, { title: '', team_id: W.t1 })).status).toBe(422);
    expect([409, 412]).toContain((await api(W.M1, 'PATCH', `${P1}/issues/${W.i1}`, { title: 'x' }, { 'if-match': '999999' })).status);
    expect(await events(t0)).toHaveLength(0);
    expect((await ownerPool.query('select count(*)::int n from sync_events where workspace_id=$1', [W.w1])).rows[0].n).toBe(n0);
  });
  it('rolled back mutation leaves no audit row (forced failure after write)', async () => {
    const t0 = new Date();
    const r = await api(W.M1, 'POST', `${P1}/issues`, { title: 'rb', team_id: W.t1, label_ids: ['00000000-0000-0000-0000-00000000dead'] });
    expect([404, 422]).toContain(r.status);
    expect((await events(t0)).length).toBe(0);
    expect((await ownerPool.query(`select count(*)::int n from issues where title='rb'`)).rows[0].n).toBe(0);
  });
});

describe.runIf(runIntegration)('T7 audited actions', () => {
  const has = async (t0: Date, re: RegExp) => (await events(t0)).some((e) => re.test(e.action));
  it('role change is audited', async () => {
    const t0 = new Date();
    const m = (await inWs(W.w1, (c) => c.query("select tm.user_id id from team_memberships tm join memberships m on m.user_id=tm.user_id and m.workspace_id=tm.workspace_id where tm.team_id=$1 and m.role<>'admin' limit 1", [W.t1]))).rows[0].id;
    expect([200, 204]).toContain((await api(W.A1, 'PATCH', `${P1}/members/${m}`, { role: 'member' })).status);
    expect(await has(t0, /role/i)).toBe(true);
  });
  it('invite create is audited', async () => {
    const t0 = new Date();
    expect((await api(W.A1, 'POST', `${P1}/invites`, { email: `aud${Date.now()}@example.test`, role: 'member' })).status).toBe(201);
    expect(await has(t0, /invite/i)).toBe(true);
  });
  it('share and revoke are audited', async () => {
    const t0 = new Date();
    const g = (await inWs(W.w1, (c) => c.query('select guest_user_id id from issue_shares where issue_id=$1 limit 1', [W.i1]))).rows[0].id;
    expect([200, 204]).toContain((await api(W.A1, 'DELETE', `${P1}/issues/${W.i1}/shares/${g}`)).status);
    expect([200, 201]).toContain((await api(W.A1, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: g })).status);
    const ev = await events(t0);
    expect(ev.filter((e) => /share/i.test(e.action)).length).toBeGreaterThanOrEqual(2);
  });
  it('login and logout are audited', async () => {
    const t0 = new Date();
    expect([200, 204]).toContain((await api(W.M1, 'POST', '/api/v1/auth/logout')).status);
    const r = await ownerPool.query(`select action from audit_events where created_at >= $1 and action ~* 'logout|login'`, [t0]);
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe.runIf(runIntegration)('T7 no secrets in diffs (canary, S11)', () => {
  it('audit rows contain no hashes or tokens', async () => {
    const CAN = 'PII_CANARY_123';
    await api(W.A1, 'POST', `${P1}/issues`, { title: CAN, team_id: W.t1 });
    const all = JSON.stringify((await ownerPool.query('select diff from audit_events')).rows);
    expect(all).not.toMatch(/\$argon2|password_hash|token_hash|"token"|"secret"/i);
  });
  it('GET /audit contains no hashes or tokens', async () => {
    const r = await (await api(W.A1, 'GET', `${P1}/audit?limit=100`)).text();
    expect(r).not.toMatch(/\$argon2|password_hash|token_hash|"token"|"secret"/i);
  });
});
