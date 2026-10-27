// @ts-nocheck TODO(M1): black-box suite drafted before the M1 routes exist; remove once typed against the real API.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment -- TODO(M1) draft suite */
import { describe, it, expect, beforeAll } from 'vitest';
import { ownerPool, api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P1 = '/api/v1/w/w1';
const mk = async (u: any) => (await (await api(u, 'POST', `${P1}/issues`, { title: 't3', team_id: W.t1 })).json()).id as string;

// Reads an SSE response for ms; returns text and whether the stream ended.
async function drain(r: Response, ms: number) {
  const rd = r.body!.getReader(); const dec = new TextDecoder(); let txt = ''; let ended = false;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const x = await Promise.race([rd.read(), new Promise<null>((res) => setTimeout(() => res(null), 300))]);
    if (x && x.done) { ended = true; break; }
    if (x?.value) txt += dec.decode(x.value);
  }
  rd.cancel().catch(() => {});
  return { txt, ended };
}

// TODO(M1): shares, members and logout routes are not merged yet.
describe.skip('T3 forget events', () => {
  it('share revoke -> guest gets forget, then nothing more for that issue', async () => {
    const g = (await ownerPool.query('select guest_user_id id from issue_shares where issue_id=$1 limit 1', [W.i1])).rows[0].id;
    const s = await api(W.G1, 'GET', `${P1}/sync?since=now`);
    expect(s.status).toBe(200);
    await api(W.A1, 'DELETE', `${P1}/issues/${W.i1}/shares/${g}`);
    await api(W.A1, 'PATCH', `${P1}/issues/${W.i1}`, { title: 'after-revoke' }, { 'if-match': '*' });
    const { txt } = await drain(s, 3000);
    expect(txt).toMatch(/"op":"forget"/);
    expect(txt).not.toContain('after-revoke');
    await api(W.A1, 'POST', `${P1}/issues/${W.i1}/shares`, { guest_user_id: g });
  });
  it('member removed -> stream closes within 60 s, later requests 404', async () => {
    const m = (await ownerPool.query('select user_id id from team_memberships where team_id=$1 limit 1', [W.t2w1])).rows[0].id;
    const s = await api(W.M2, 'GET', `${P1}/sync?since=now`);
    await api(W.A1, 'DELETE', `${P1}/members/${m}`);
    const { ended } = await drain(s, 65_000);
    expect(ended).toBe(true);
    expect((await api(W.M2, 'GET', `${P1}/issues`)).status).toBe(404);
  }, 80_000);
  it('session revoked -> stream closes immediately; reconnect is 401', async () => {
    const s = await api(W.M1, 'GET', `${P1}/sync?since=now`);
    await api(W.M1, 'POST', '/api/v1/auth/logout');
    expect((await drain(s, 5000)).ended).toBe(true);
    expect((await api(W.M1, 'GET', `${P1}/sync?since=now`)).status).toBe(401);
  });
});

describe.runIf(runIntegration)('T3 since cursor', () => {
  it('since older than 7 days -> 410 RESYNC_REQUIRED', async () => {
    await ownerPool.query(`update sync_events set created_at = now() - interval '8 days' where workspace_id=$1`, [W.w1]);
    const r = await api(W.A1, 'GET', `${P1}/sync?since=1`);
    expect(r.status).toBe(410);
    expect((await r.json()).error.code).toBe('RESYNC_REQUIRED');
  });
  it('since from another workspace -> 404 or 400', async () => {
    const max = (await ownerPool.query('select max(sync_id)::bigint m from sync_events where workspace_id=$1', [W.w2])).rows[0].m ?? 0;
    expect([400, 404]).toContain((await api(W.A1, 'GET', `${P1}/sync?since=${Number(max) + 100000}`)).status);
  });
});

describe.runIf(runIntegration)('T3 soft delete', () => {
  it('delete hides issue everywhere, member restores, guest cannot', async () => {
    const id = await mk(W.M1);
    const s = await api(W.M1, 'GET', `${P1}/sync?since=now`);
    await api(W.M1, 'DELETE', `${P1}/issues/${id}`);
    expect((await drain(s, 2000)).txt).toMatch(/"op":"forget"/);
    for (const p of ['/issues', `/search?q=t3`, '/sync?since=0']) {
      const r = await api(W.M1, 'GET', P1 + p);
      if (p.startsWith('/sync')) { expect((await drain(r, 1500)).txt).not.toContain(id); } else expect(await r.text()).not.toContain(id);
    }
    expect([403, 404]).toContain((await api(W.G1, 'POST', `${P1}/issues/${id}/restore`)).status);
    expect([200, 204]).toContain((await api(W.M1, 'POST', `${P1}/issues/${id}/restore`)).status);
  });
  it('after purge, restore -> 404', async () => {
    const id = await mk(W.M1);
    await api(W.M1, 'DELETE', `${P1}/issues/${id}`);
    await ownerPool.query('delete from issues where id=$1', [id]); // simulates the daily purge
    expect((await api(W.M1, 'POST', `${P1}/issues/${id}/restore`)).status).toBe(404);
  });
  it('deleted over 30 days ago -> restore 404', async () => {
    const id = await mk(W.M1);
    await api(W.M1, 'DELETE', `${P1}/issues/${id}`);
    await ownerPool.query(`update issues set deleted_at = now() - interval '31 days' where id=$1`, [id]);
    expect((await api(W.M1, 'POST', `${P1}/issues/${id}/restore`)).status).toBe(404);
  });
});
