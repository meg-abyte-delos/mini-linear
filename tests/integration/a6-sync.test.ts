// Area 6 server side (black-box, running app + DB): change-feed visibility, sealed cursors, resync, retention,
// SSE auth loss, presence, writer lock order, trigger semantics.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inWs, api, world, appPool, ownerPool, loginAs, PW } from './helpers/world';
import { hashPassword } from '../../src/lib/auth/password';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
type Ev = { id: string; entity: string; entity_id: string; issue_id: string; op: string; version: number };
type Page = { events: Ev[]; cursor: string; resync: boolean };
const feed = async (u: typeof W.M1, after?: string): Promise<Page> => {
  const r = await api(u, 'GET', `${P}/sync${after ? `?after=${encodeURIComponent(after)}` : ''}`);
  expect(r.status).toBe(200);
  return r.json();
};
const mkIssue = async (u: typeof W.M1, team: string, title = 'sync') => {
  const r = await api(u, 'POST', `${P}/issues`, { title, team_id: team });
  expect(r.status).toBe(201);
  return (await r.json()).id as string;
};

beforeAll(async () => { if (runIntegration) W = await world(); });

describe.runIf(runIntegration)('A6 readFeed visibility', () => {
  it('member of the team, admin and a non-member see different slices; guest sees only shared issues', async () => {
    const c = { m1: (await feed(W.M1)).cursor, a1: (await feed(W.A1)).cursor, m2: (await feed(W.M2)).cursor, g1: (await feed(W.G1)).cursor };
    const inTeam = await mkIssue(W.M1, W.t1, 'visible to team T1');
    // an update on the issue shared with the guest (i1), written as owner: the trigger still fires
    await inWs(W.w1, (x) => x.query("update issues set title = 'shared edit', version = version + 1 where id = $1", [W.i1]));
    const m1 = await feed(W.M1, c.m1), a1 = await feed(W.A1, c.a1), m2 = await feed(W.M2, c.m2), g1 = await feed(W.G1, c.g1);
    expect(m1.events.map((e) => e.issue_id)).toEqual(expect.arrayContaining([inTeam, W.i1]));
    expect(a1.events.map((e) => e.issue_id)).toEqual(expect.arrayContaining([inTeam, W.i1]));
    expect(m2.events.map((e) => e.issue_id)).not.toContain(inTeam); // M2 is not in T1
    expect(g1.events.map((e) => e.issue_id)).toEqual([W.i1]); // shared issue only
    expect(g1.events[0]).toMatchObject({ entity: 'issue', op: 'update' });
  });
  it('cursors and event ids are opaque: no sequence number reaches a client', async () => {
    const c = (await feed(W.M2)).cursor;
    await mkIssue(W.M1, W.t1, 'invisible to M2');
    const p = await feed(W.M2, c);
    expect(p.events).toEqual([]);
    expect(p.cursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p.cursor).not.toBe(c); // advanced past the invisible event, but sealed
    expect(/^\d+$/.test(p.cursor)).toBe(false);
    const m1 = await feed(W.M1, (await feed(W.M1)).cursor);
    expect(m1.events).toEqual([]);
  });
  it('a revoked share stops the guest seeing events of that issue', async () => {
    const g = await feed(W.G1);
    await inWs(W.w1, (x) => x.query('update issue_shares set revoked_at = now() where issue_id = $1 and guest_user_id = $2', [W.i1, W.G1id]));
    await inWs(W.w1, (x) => x.query("update issues set title = 'after revoke', version = version + 1 where id = $1", [W.i1]));
    expect((await feed(W.G1, g.cursor)).events).toEqual([]);
    await inWs(W.w1, (x) => x.query('update issue_shares set revoked_at = null where issue_id = $1 and guest_user_id = $2', [W.i1, W.G1id]));
  });
});

describe.runIf(runIntegration)('A6 resync', () => {
  it('forged, foreign-user and malformed cursors resync (never a 500), with a fresh cursor', async () => {
    const mine = (await feed(W.M1)).cursor, theirs = (await feed(W.M2)).cursor;
    for (const bad of ['AAAAAAAAAAAAAAAAAAAAAA', theirs, '5', '-1', 'x'.repeat(60), mine.slice(0, 5) + (mine[5] === 'A' ? 'B' : 'A') + mine.slice(6)]) {
      const p = await feed(W.M1, bad);
      expect(p.resync, bad).toBe(true);
      expect(p.events).toEqual([]);
      expect(p.cursor).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }
  });
  it('a cursor below pruned_upto resyncs after retention ran (purge_sync_events via the app role)', async () => {
    const old = (await feed(W.M1)).cursor;
    const id = await mkIssue(W.M1, W.t1, 'to be pruned');
    expect((await feed(W.M1, old)).events.map((e) => e.issue_id)).toContain(id);
    await inWs(W.w1, (x) => x.query("update sync_events set created_at = now() - interval '10 days'"));
    await appPool.query('select purge_sync_events()');
    const left = await inWs(W.w1, (x) => x.query('select count(*)::int n from sync_events'));
    expect(left.rows[0].n).toBe(0);
    const p = await feed(W.M1, old);
    expect(p.resync).toBe(true);
    // the fresh cursor works
    await mkIssue(W.M1, W.t1, 'after prune');
    const q = await feed(W.M1, p.cursor);
    expect(q.resync).toBe(false);
    expect(q.events).toHaveLength(1);
  });
  it('retention keeps recent events and never lets a caller keep less than a day', async () => {
    const c = (await feed(W.M1)).cursor;
    await mkIssue(W.M1, W.t1, 'recent');
    await appPool.query("select purge_sync_events(interval '0 seconds')");
    const p = await feed(W.M1, c);
    expect(p.resync).toBe(false);
    expect(p.events).toHaveLength(1);
  });
});

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
/** Reads an SSE response until `until` matches the accumulated text, the stream ends, or the deadline passes. */
async function readSse(res: Response, until: RegExp, ms: number) {
  const rd = res.body!.getReader(), dec = new TextDecoder();
  let text = '', ended = false;
  const stop = Date.now() + ms;
  while (Date.now() < stop && !until.test(text)) {
    const r = await Promise.race([rd.read(), new Promise<null>((s) => setTimeout(() => s(null), Math.max(50, stop - Date.now())))]);
    if (r === null) break;
    if (r.done) { ended = true; break; }
    text += dec.decode(r.value);
  }
  if (!ended) await rd.cancel().catch(() => undefined);
  return { text, ended };
}
const extraMember = async (role: 'member' | 'admin', tag: string) => {
  const u = { id: randomUUID(), email: `${tag}-${randomUUID().slice(0, 6)}@example.test`, cookie: '' };
  const hash = await hashPassword(PW);
  await inWs(W.w1, async (c) => {
    await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [u.id, u.email, hash]);
    await c.query('insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,$4)', [randomUUID(), W.w1, u.id, role]);
  });
  u.cookie = await loginAs(u.email);
  return u;
};

describe.runIf(runIntegration)('A6 SSE', () => {
  it('streams visible events, with sealed ids, to an authenticated member', async () => {
    const ac = new AbortController();
    const res = await fetch(`${BASE}${P}/events`, { headers: { cookie: W.M1.cookie!, origin: BASE }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const id = await mkIssue(W.M1, W.t1, 'streamed');
    const { text } = await readSse(res, /event: issue\.create/, 8000);
    ac.abort();
    expect(text).toContain(id);
    expect(/^id: \d+$/m.test(text)).toBe(false);
  }, 15_000);
  it('unauthenticated -> 401 JSON, no stream', async () => {
    const r = await fetch(`${BASE}${P}/events`, { headers: { origin: BASE } });
    expect(r.status).toBe(401);
  });
  it('closes with an auth event when membership is removed (next tick)', async () => {
    const u = await extraMember('member', 'sse-m');
    const res = await fetch(`${BASE}${P}/events`, { headers: { cookie: u.cookie, origin: BASE } });
    expect(res.status).toBe(200);
    await inWs(W.w1, (c) => c.query('delete from memberships where user_id = $1', [u.id]));
    const { text } = await readSse(res, /event: auth/, 8000);
    expect(text).toMatch(/event: auth/);
  }, 15_000);
  it('closes with an auth event after logout (session re-checked within a few ticks)', async () => {
    const u = await extraMember('member', 'sse-s');
    const res = await fetch(`${BASE}${P}/events`, { headers: { cookie: u.cookie, origin: BASE } });
    expect(res.status).toBe(200);
    const lo = await api(u, 'POST', '/api/v1/auth/logout');
    expect([200, 204]).toContain(lo.status);
    const { text } = await readSse(res, /event: auth/, 20_000);
    expect(text).toMatch(/event: auth/);
  }, 30_000);
});

describe.runIf(runIntegration)('A6 presence', () => {
  const ids = (j: { viewers: { user_id: string }[] }) => j.viewers.map((v) => v.user_id);
  it('heartbeat, list, leave; non-members get 404', async () => {
    const id = await mkIssue(W.M1, W.t1, 'presence');
    const pu = `${P}/issues/${id}/presence`;
    expect(ids(await (await api(W.M1, 'POST', pu)).json())).toContain(W.M1.id);
    expect(ids(await (await api(W.A1, 'GET', pu)).json())).toContain(W.M1.id);
    expect((await api(W.M2, 'GET', pu)).status).toBe(404);
    expect((await api(W.G1, 'GET', pu)).status).toBe(404);
    expect((await (await api(W.M1, 'DELETE', pu)).json()).viewers).toEqual([]);
  });
  it('guests get a count and only themselves, never the other users ids', async () => {
    const pu = `${P}/issues/${W.i1}/presence`;
    await api(W.M1, 'POST', pu);
    const g = await (await api(W.G1, 'GET', pu)).json();
    expect(g.count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(g)).not.toContain(W.M1.id);
    await api(W.G1, 'POST', pu);
    expect(ids(await (await api(W.G1, 'GET', pu)).json())).toEqual([W.G1id]);
    await api(W.M1, 'DELETE', pu); await api(W.G1, 'DELETE', pu);
  });
});

describe.runIf(runIntegration)('A6 writers and triggers', () => {
  type C = import('pg').PoolClient;
  const tx = async (fn: (c: C) => Promise<void>, user?: string) => {
    const c = await ownerPool.connect();
    try {
      await c.query('begin'); await c.query("select set_config('app.workspace_id', $1, true)", [W.w1]);
      if (user) await c.query("select set_config('app.user_id', $1, true)", [user]);
      await fn(c); await c.query('commit');
    } catch (e) { await c.query('rollback').catch(() => undefined); throw e; } finally { c.release(); }
  };
  const upd = (c: C, id: string) => c.query("update issues set title = title || '.', version = version + 1 where id = $1", [id]);
  const count = async (id: string) => (await inWs(W.w1, (c) => c.query('select count(*)::int n from sync_events where issue_id = $1', [id]))).rows[0].n as number;
  it('two bulk writers touching the same issues in opposite order do not deadlock (seq lock first)', async () => {
    const ids = [await mkIssue(W.M1, W.t1, 'lock-a'), await mkIssue(W.M1, W.t1, 'lock-b'), await mkIssue(W.M1, W.t1, 'lock-c')];
    const nap = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        tx(async (c) => { for (const id of ids) { await upd(c, id); await nap(30); } }),
        tx(async (c) => { for (const id of [...ids].reverse()) { await upd(c, id); await nap(30); } }),
      ]);
    }
    const n = await inWs(W.w1, (c) => c.query('select count(*)::int n, count(distinct id)::int d from sync_events'));
    expect(n.rows[0].n).toBe(n.rows[0].d);
  }, 30_000);
  it('sort_key-only updates emit nothing; a real edit does, attributed to the updater', async () => {
    const id = await mkIssue(W.M1, W.t1, 'reorder');
    const before = await count(id);
    await tx(async (c) => { await c.query("update issues set sort_key = 'zzzz', version = version + 1 where id = $1", [id]); });
    expect(await count(id)).toBe(before);
    await tx(async (c) => { await upd(c, id); }, W.A1id);
    const rows = (await inWs(W.w1, (c) => c.query('select actor_id, op from sync_events where issue_id = $1 order by id desc limit 1', [id]))).rows;
    expect(rows[0]).toMatchObject({ actor_id: W.A1id, op: 'update' });
    expect(await count(id)).toBe(before + 1);
  });
});
