// Wave 1 / lane 3 (Tess): presence API edge cases + negative authz (unauthenticated, cross-workspace, guest, revoked share).
// Black-box against a running app + DB, written from the API contract (Ada, 4a307bb), not from handler code.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inWs, api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
const mkIssue = async (u: typeof W.M1, team: string, title = 'w1-l3') => {
  const r = await api(u, 'POST', `${P}/issues`, { title, team_id: team });
  expect(r.status).toBe(201);
  return (await r.json()).id as string;
};
const ids = (j: { viewers: { user_id: string }[] }) => j.viewers.map((v) => v.user_id);

beforeAll(async () => { if (runIntegration) W = await world(); });

describe.runIf(runIntegration)('presence: heartbeat semantics', () => {
  it('heartbeat is idempotent: two POSTs from one user give one viewer and a refreshed seen_at', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const pu = `${P}/issues/${id}/presence`;
    const a = await (await api(W.M1, 'POST', pu)).json();
    await new Promise((r) => setTimeout(r, 50));
    const b = await (await api(W.M1, 'POST', pu)).json();
    expect(ids(a)).toEqual([W.M1.id]);
    expect(ids(b)).toEqual([W.M1.id]);
    expect(b.count).toBe(1);
    expect(new Date(b.viewers[0].seen_at).getTime()).toBeGreaterThanOrEqual(new Date(a.viewers[0].seen_at).getTime());
    const rows = await inWs(W.w1, (c) => c.query('select count(*)::int n from issue_presence where issue_id = $1', [id]));
    expect(rows.rows[0].n).toBe(1);
  });

  it('two users on one issue: both listed, newest first; leaving removes only the leaver', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const pu = `${P}/issues/${id}/presence`;
    await api(W.M1, 'POST', pu);
    await new Promise((r) => setTimeout(r, 30));
    await api(W.A1, 'POST', pu);
    const both = await (await api(W.M1, 'GET', pu)).json();
    expect(ids(both)).toEqual([W.A1.id, W.M1.id]);
    const after = await (await api(W.A1, 'DELETE', pu)).json();
    expect(ids(after)).toEqual([W.M1.id]);
    expect(after.count).toBe(1);
  });

  it('entries older than the 30 s TTL are not reported', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const pu = `${P}/issues/${id}/presence`;
    await api(W.M1, 'POST', pu);
    await inWs(W.w1, (c) => c.query("update issue_presence set seen_at = now() - interval '31 seconds' where issue_id = $1 and user_id = $2", [id, W.M1.id]));
    const j = await (await api(W.A1, 'GET', pu)).json();
    expect(j.viewers).toEqual([]);
    expect(j.count).toBe(0);
    // an entry just inside the TTL is still reported
    await inWs(W.w1, (c) => c.query("update issue_presence set seen_at = now() - interval '25 seconds' where issue_id = $1 and user_id = $2", [id, W.M1.id]));
    expect(ids(await (await api(W.A1, 'GET', pu)).json())).toEqual([W.M1.id]);
  });

  it('DELETE when never present is a harmless 200 with no viewers', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const r = await api(W.M1, 'DELETE', `${P}/issues/${id}/presence`);
    expect(r.status).toBe(200);
    expect((await r.json()).viewers).toEqual([]);
  });

  it('responses are not cacheable', async () => {
    const r = await api(W.M1, 'GET', `${P}/issues/${W.i1}/presence`);
    expect(r.headers.get('cache-control')).toMatch(/no-store/);
  });
});

describe.runIf(runIntegration)('presence: negative authz and bad input', () => {
  it('no session: 401 on GET, POST and DELETE', async () => {
    for (const m of ['GET', 'POST', 'DELETE']) {
      const r = await api(null, m, `${P}/issues/${W.i1}/presence`);
      expect(r.status, m).toBe(401);
      expect((await r.json()).error.code).toBe('unauthenticated');
    }
  });

  it('cross-workspace: a w2 member gets 404 on a w1 issue (read and heartbeat) and leaves no row', async () => {
    const pu = `${P}/issues/${W.i1}/presence`;
    expect((await api(W.B1, 'GET', pu)).status).toBe(404);
    expect((await api(W.B1, 'POST', pu)).status).toBe(404);
    const n = await inWs(W.w1, (c) => c.query('select count(*)::int n from issue_presence where user_id = $1', [W.B1.id]));
    expect(n.rows[0].n).toBe(0);
  });

  it('a w1 issue id addressed under the w2 slug is 404 for a w2 member', async () => {
    expect((await api(W.B1, 'GET', `/api/v1/w/w2/issues/${W.i1}/presence`)).status).toBe(404);
  });

  it('registered user who belongs to no workspace gets 404, not 403', async () => {
    expect((await api(W.N, 'GET', `${P}/issues/${W.i1}/presence`)).status).toBe(404);
  });

  it('unknown workspace slug: 404', async () => {
    expect((await api(W.M1, 'GET', `/api/v1/w/no-such-ws-${randomUUID().slice(0, 6)}/issues/${W.i1}/presence`)).status).toBe(404);
  });

  it('malformed or unknown issue id: 404', async () => {
    expect((await api(W.M1, 'GET', `${P}/issues/not-a-uuid/presence`)).status).toBe(404);
    expect((await api(W.M1, 'POST', `${P}/issues/${randomUUID()}/presence`)).status).toBe(404);
  });

  it('issue in a team the member does not belong to: 404 for read and heartbeat', async () => {
    const id = await mkIssue(W.A1, W.t1, 'team T1 only');
    expect((await api(W.M2, 'GET', `${P}/issues/${id}/presence`)).status).toBe(404);
    expect((await api(W.M2, 'POST', `${P}/issues/${id}/presence`)).status).toBe(404);
  });

  it('soft-deleted issue: 404', async () => {
    const id = await mkIssue(W.M1, W.t1, 'to delete');
    await inWs(W.w1, (c) => c.query('update issues set deleted_at = now() where id = $1', [id]));
    expect((await api(W.M1, 'GET', `${P}/issues/${id}/presence`)).status).toBe(404);
  });

  it('guest without a share is 404; after the share is revoked the guest loses access', async () => {
    const id = await mkIssue(W.M1, W.t1, 'guest share');
    const pu = `${P}/issues/${id}/presence`;
    expect((await api(W.G1, 'POST', pu)).status).toBe(404);
    const sh = await api(W.M1, 'POST', `${P}/issues/${id}/shares`, { guest_user_id: W.G1.id });
    if (![200, 201].includes(sh.status)) { // share body shape not in contract: fall back to direct insert
      await inWs(W.w1, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [W.w1, id, W.G1.id, W.M1.id]));
    }
    expect((await api(W.G1, 'POST', pu)).status).toBe(200);
    await inWs(W.w1, (c) => c.query('update issue_shares set revoked_at = now() where issue_id = $1 and guest_user_id = $2', [id, W.G1.id]));
    expect((await api(W.G1, 'GET', pu)).status).toBe(404);
    expect((await api(W.G1, 'POST', pu)).status).toBe(404);
  }, 30_000);

  it('guest sees a count but never other users ids, even with several viewers', async () => {
    const pu = `${P}/issues/${W.i1}/presence`;
    await api(W.M1, 'POST', pu); await api(W.A1, 'POST', pu);
    const g = await (await api(W.G1, 'GET', pu)).json();
    expect(g.count).toBeGreaterThanOrEqual(2);
    const s = JSON.stringify(g);
    expect(s).not.toContain(W.M1.id);
    expect(s).not.toContain(W.A1.id);
    await api(W.M1, 'DELETE', pu); await api(W.A1, 'DELETE', pu);
  }, 30_000);

  it('cross-origin POST is refused (CSRF origin check), and writes nothing', async () => {
    const id = await mkIssue(W.M1, W.t1, 'csrf');
    const r = await api(W.M1, 'POST', `${P}/issues/${id}/presence`, undefined, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    const n = await inWs(W.w1, (c) => c.query('select count(*)::int n from issue_presence where issue_id = $1', [id]));
    expect(n.rows[0].n).toBe(0);
  });

  it('unsupported methods are not routed (no 2xx, no 500)', async () => {
    for (const m of ['PUT', 'PATCH']) {
      const r = await api(W.M1, m, `${P}/issues/${W.i1}/presence`);
      expect(r.status, m).toBeGreaterThanOrEqual(400);
      expect(r.status, m).toBeLessThan(500);
    }
  });
});

describe.runIf(runIntegration)('cross-workspace sweep: a w2 member never reads or writes w1 data', () => {
  const reads = ['issues', 'projects', 'cycles', 'labels', 'members', 'teams', 'views', 'notifications', 'settings', 'audit', 'webhooks', 'api-keys', 'invites', 'search?q=seed'];
  it.each(reads)('GET %s => 404', async (r) => {
    const res = await api(W.B1, 'GET', `${P}/${r}`);
    expect(res.status).toBe(404);
  });
  it('GET /issues/{w1 issue} and its sub-resources => 404', async () => {
    for (const sub of ['', '/activity', '/comments', '/children', '/relations', '/attachments', '/subscription', '/shares']) {
      expect((await api(W.B1, 'GET', `${P}/issues/${W.i1}${sub}`)).status, sub).toBe(404);
    }
  });
  it('writes into w1 => 404 and nothing is created', async () => {
    const before = await inWs(W.w1, (c) => c.query('select count(*)::int n from issues'));
    expect((await api(W.B1, 'POST', `${P}/issues`, { title: 'intruder', team_id: W.t1 })).status).toBe(404);
    expect((await api(W.B1, 'PATCH', `${P}/issues/${W.i1}`, { title: 'pwned' }, { 'if-match': '1' })).status).toBe(404);
    expect((await api(W.B1, 'DELETE', `${P}/issues/${W.i1}`, undefined, { 'if-match': '1' })).status).toBe(404);
    const after = await inWs(W.w1, (c) => c.query('select count(*)::int n from issues'));
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const t = await inWs(W.w1, (c) => c.query('select title from issues where id = $1', [W.i1]));
    expect(t.rows[0].title).not.toBe('pwned');
  });
  it('a w2 member cannot create an issue in w2 pointing at a w1 team (no cross-tenant FK leak)', async () => {
    const r = await api(W.B1, 'POST', '/api/v1/w/w2/issues', { title: 'x-tenant', team_id: W.t1 });
    expect([403, 404, 422]).toContain(r.status);
  });
});
