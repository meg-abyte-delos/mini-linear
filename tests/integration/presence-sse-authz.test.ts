// Wave 0 back (Tess): workspace presence route (POST|DELETE /w/:slug/presence {issue_id}) and the SSE `presence` event from #184.
// Black-box against a running app + DB, written from the PR contract: authz (anon, cross-workspace, guest, team), validation, no leak between workspaces,
// fresh snapshot on every new stream (what a reconnect does), empty list on leave / TTL expiry.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inWs, api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
type Pres = { issue_id: string; viewers: string[]; count: number };
const mkIssue = async (u: typeof W.M1, team: string, title = 'presence-sse') => {
  const r = await api(u, 'POST', `${P}/issues`, { title, team_id: team });
  expect(r.status).toBe(201);
  return (await r.json()).id as string;
};
const beat = (u: typeof W.M1, issue_id: string, method = 'POST', slug = 'w1') => api(u, method, `/api/v1/w/${slug}/presence`, { issue_id });
const rows = async (ws: string, id: string) => (await inWs(ws, (c) => c.query('select user_id from issue_presence where issue_id = $1 order by user_id', [id]))).rows.map((r) => r.user_id as string);

/** Opens the feed, collects frames until `until(frames)` holds or `ms` passes, then closes. Returns the raw text and the parsed `presence` events. */
async function feed(u: typeof W.M1 | null, slug: string, until: (p: Pres[]) => boolean, ms = 7000) {
  const ac = new AbortController();
  const res = await fetch(`${BASE}/api/v1/w/${slug}/events`, { headers: { ...(u?.cookie ? { cookie: u.cookie } : {}), origin: BASE }, signal: ac.signal });
  if (res.status !== 200) { ac.abort(); return { status: res.status, text: '', events: [] as Pres[], blocks: [] as string[] }; }
  const rd = res.body!.getReader(), dec = new TextDecoder();
  let text = ''; const stop = Date.now() + ms;
  const parse = () => text.split('\n\n').filter((b) => /^event: presence$/m.test(b));
  const evs = () => parse().map((b) => JSON.parse(b.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as Pres);
  while (Date.now() < stop && !until(evs())) {
    const r = await Promise.race([rd.read(), new Promise<null>((s) => setTimeout(() => s(null), Math.max(50, stop - Date.now())))]);
    if (r === null || r.done) break;
    text += dec.decode(r.value);
  }
  await rd.cancel().catch(() => undefined); ac.abort();
  return { status: 200, text, events: evs(), blocks: parse() };
}
const lastFor = (ps: Pres[], id: string) => ps.filter((p) => p.issue_id === id).at(-1);

beforeAll(async () => { if (runIntegration) W = await world(); });

describe.runIf(runIntegration)('presence body route: authn / authz / validation', () => {
  it('no session: 401 on POST and DELETE, nothing written', async () => {
    const id = await mkIssue(W.M1, W.t1);
    for (const m of ['POST', 'DELETE']) expect((await beat(null as never, id, m)).status, m).toBe(401);
    expect(await rows(W.w1, id)).toEqual([]);
  });

  it('heartbeat then leave through the body route; the per-issue GET sees the same state', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const a = await beat(W.M1, id);
    expect(a.status).toBe(200);
    expect((await a.json()).viewers.map((v: { user_id: string }) => v.user_id)).toEqual([W.M1.id]);
    const g = await (await api(W.A1, 'GET', `${P}/issues/${id}/presence`)).json();
    expect(g.viewers.map((v: { user_id: string }) => v.user_id)).toEqual([W.M1.id]);
    await beat(W.A1, id);
    const left = await (await beat(W.M1, id, 'DELETE')).json();
    expect(left.viewers.map((v: { user_id: string }) => v.user_id)).toEqual([W.A1.id]);
    expect(await rows(W.w1, id)).toEqual([W.A1.id]);
  });

  it('invalid bodies are 4xx validation errors, never 5xx, and write nothing', async () => {
    const n0 = (await inWs(W.w1, (c) => c.query('select count(*)::int n from issue_presence'))).rows[0].n;
    const bodies: unknown[] = [undefined, {}, { issue_id: 42 }, { issue_id: null }, { issue_id: ['x'] }, { issue_id: 'x'.repeat(65) }, { issue: W.i1 }, []];
    for (const b of bodies) {
      const r = await api(W.M1, 'POST', `${P}/presence`, b);
      expect(r.status, JSON.stringify(b)).toBeGreaterThanOrEqual(400);
      expect(r.status, JSON.stringify(b)).toBeLessThan(500);
    }
    const raw = await fetch(`${BASE}${P}/presence`, { method: 'POST', headers: { cookie: W.M1.cookie!, origin: BASE, 'content-type': 'application/json' }, body: '{not json' });
    expect(raw.status).toBeGreaterThanOrEqual(400); expect(raw.status).toBeLessThan(500);
    expect((await inWs(W.w1, (c) => c.query('select count(*)::int n from issue_presence'))).rows[0].n).toBe(n0);
  });

  it('well-formed but unknown or foreign issue ids are 404 (a malformed id is 400 or 404, never 5xx)', async () => {
    expect((await beat(W.M1, randomUUID())).status).toBe(404);
    expect([400, 404]).toContain((await beat(W.M1, 'not-a-uuid')).status);
    expect((await beat(W.M1, W.i2)).status).toBe(404); // w2 issue addressed under w1
  });

  it('cross-workspace: a w2 member cannot heartbeat or leave a w1 issue, under either slug, and leaves no row', async () => {
    const id = await mkIssue(W.M1, W.t1);
    for (const slug of ['w1', 'w2']) for (const m of ['POST', 'DELETE']) expect((await beat(W.B1, id, m, slug)).status, `${slug} ${m}`).toBe(404);
    expect(await rows(W.w1, id)).toEqual([]);
  });

  it('a user in no workspace and an unknown slug are 404', async () => {
    expect((await beat(W.N, W.i1)).status).toBe(404);
    expect((await beat(W.M1, W.i1, 'POST', 'no-such-ws')).status).toBe(404);
  });

  it('DELETE by a non-viewer does not remove someone else\'s presence', async () => {
    const id = await mkIssue(W.M1, W.t1);
    await beat(W.M1, id);
    expect((await beat(W.A1, id, 'DELETE')).status).toBe(200);
    expect(await rows(W.w1, id)).toEqual([W.M1.id]);
  });

  it('issue of a team the member is not in: 404, nothing written', async () => {
    const id = await inWs(W.w1, async (c) => { const i = randomUUID(); await c.query('insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [i, W.w1, W.t2w1, 9000 + Math.floor(Math.random() * 9000), 'ops only', 'z', W.A1.id]); return i; });
    expect((await beat(W.M1, id)).status).toBe(404);
    expect(await rows(W.w1, id)).toEqual([]);
  });

  it('soft-deleted issue: 404', async () => {
    const id = await mkIssue(W.M1, W.t1);
    await inWs(W.w1, (c) => c.query('update issues set deleted_at = now() where id = $1', [id]));
    expect((await beat(W.M1, id)).status).toBe(404);
  });

  it('guest: 404 without a share, 200 with a share and only its own id back, 404 again once revoked', async () => {
    const id = await mkIssue(W.M1, W.t1, 'guest body route');
    expect((await beat(W.G1, id)).status).toBe(404);
    await inWs(W.w1, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [W.w1, id, W.G1.id, W.M1.id]));
    await beat(W.M1, id);
    const r = await beat(W.G1, id);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.count).toBe(2);
    expect(JSON.stringify(j)).not.toContain(W.M1.id);
    await inWs(W.w1, (c) => c.query('update issue_shares set revoked_at = now() where issue_id = $1 and guest_user_id = $2', [id, W.G1.id]));
    expect((await beat(W.G1, id)).status).toBe(404);
    expect((await beat(W.G1, id, 'DELETE')).status).toBe(404);
  }, 30_000);

  it('cross-origin POST is refused (403) and writes nothing', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const r = await api(W.M1, 'POST', `${P}/presence`, { issue_id: id }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(await rows(W.w1, id)).toEqual([]);
  });

  it('GET and PUT are not routed on the body route (no 2xx, no 5xx)', async () => {
    for (const m of ['GET', 'PUT', 'PATCH']) {
      const r = await api(W.M1, m, `${P}/presence`);
      expect(r.status, m).toBeGreaterThanOrEqual(400); expect(r.status, m).toBeLessThan(500);
    }
  });
});

describe.runIf(runIntegration)('SSE presence event: snapshot, change, leave, no leak', () => {
  it('feed without a session is 401 and carries no presence', async () => {
    const r = await feed(null, 'w1', () => true, 1500);
    expect(r.status).toBe(401);
  });

  it('a new stream opens with a snapshot of who is viewing (this is what a reconnect gets)', async () => {
    const id = await mkIssue(W.M1, W.t1);
    await beat(W.M1, id); await beat(W.A1, id);
    for (let pass = 0; pass < 2; pass++) { // two consecutive streams = reconnect: the snapshot is sent again
      const r = await feed(W.A1, 'w1', (p) => !!lastFor(p, id));
      const p = lastFor(r.events, id)!;
      expect(p, `stream ${pass}`).toBeTruthy();
      expect([...p.viewers].sort()).toEqual([W.A1.id, W.M1.id].sort());
      expect(p.count).toBe(2);
    }
  }, 30_000);

  it('presence frames carry no id: line, so they never move Last-Event-ID', async () => {
    const id = await mkIssue(W.M1, W.t1);
    await beat(W.M1, id);
    const r = await feed(W.A1, 'w1', (p) => !!lastFor(p, id));
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) expect(b).not.toMatch(/^id:/m);
  });

  it('a heartbeat while the stream is open produces an event, a leave produces an empty list', async () => {
    const id = await mkIssue(W.M1, W.t1);
    const ac = feed(W.A1, 'w1', (p) => lastFor(p, id)?.count === 0 && p.some((x) => x.issue_id === id && x.count > 0), 14_000);
    await new Promise((r) => setTimeout(r, 1500));
    await beat(W.M1, id);
    await new Promise((r) => setTimeout(r, 3500));
    await beat(W.M1, id, 'DELETE');
    const r = await ac;
    const mine = r.events.filter((p) => p.issue_id === id);
    expect(mine[0]).toEqual({ issue_id: id, viewers: [W.M1.id], count: 1 });
    expect(mine.at(-1)).toEqual({ issue_id: id, viewers: [], count: 0 });
  }, 30_000);

  it('an entry past the 30 s TTL is reported as an empty list, not left stale', async () => {
    const id = await mkIssue(W.M1, W.t1);
    await beat(W.M1, id);
    const p = feed(W.A1, 'w1', (e) => lastFor(e, id)?.count === 0 && e.some((x) => x.issue_id === id && x.count > 0), 14_000);
    await new Promise((r) => setTimeout(r, 2500));
    await inWs(W.w1, (c) => c.query("update issue_presence set seen_at = now() - interval '31 seconds' where issue_id = $1", [id]));
    const r = await p;
    expect(lastFor(r.events, id)).toEqual({ issue_id: id, viewers: [], count: 0 });
  }, 30_000);

  it('no leak between workspaces: a w2 stream never mentions w1 issues or users, and vice versa', async () => {
    const id1 = await mkIssue(W.M1, W.t1);
    await beat(W.M1, id1);
    const id2 = await inWs(W.w2, async (c) => { const i = randomUUID(); await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3) on conflict do nothing', [W.w2, W.t2, W.B1.id]); await c.query('insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [i, W.w2, W.t2, 7000 + Math.floor(Math.random() * 900), 'w2 issue', 'a', W.B1.id]); await c.query('insert into issue_presence (workspace_id, issue_id, user_id) values ($1,$2,$3)', [W.w2, i, W.B1.id]); return i; });
    const b = await feed(W.B1, 'w2', (p) => !!lastFor(p, id2));
    expect(lastFor(b.events, id2)).toEqual({ issue_id: id2, viewers: [W.B1.id], count: 1 });
    for (const s of [id1, W.M1.id, W.A1.id]) expect(b.text).not.toContain(s);
    const a = await feed(W.M1, 'w1', (p) => !!lastFor(p, id1));
    expect(lastFor(a.events, id1)).toBeTruthy();
    for (const s of [id2, W.B1.id]) expect(a.text).not.toContain(s);
  }, 30_000);

  it('a w2 member cannot open the w1 feed (404), a non-member neither', async () => {
    expect((await feed(W.B1, 'w1', () => true, 1500)).status).toBe(404);
    expect((await feed(W.N, 'w1', () => true, 1500)).status).toBe(404);
  });

  it('presence on an issue of a team the member is not in never appears in their stream', async () => {
    const id = await inWs(W.w1, async (c) => { const i = randomUUID(); await c.query('insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [i, W.w1, W.t2w1, 9100 + Math.floor(Math.random() * 800), 'ops only 2', 'z', W.A1.id]); await c.query('insert into issue_presence (workspace_id, issue_id, user_id) values ($1,$2,$3)', [W.w1, i, W.A1.id]); return i; });
    const ctrl = await mkIssue(W.M1, W.t1); await beat(W.M1, ctrl);
    const r = await feed(W.M1, 'w1', (p) => !!lastFor(p, ctrl));
    expect(lastFor(r.events, ctrl)).toBeTruthy(); // the stream was live and had the snapshot
    expect(r.text).not.toContain(id);
  }, 30_000);

  it('guest stream: only issues shared with them, only their own id in viewers, others as a count', async () => {
    const shared = await mkIssue(W.M1, W.t1, 'shared sse');
    const hidden = await mkIssue(W.M1, W.t1, 'hidden sse');
    await inWs(W.w1, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [W.w1, shared, W.G1.id, W.M1.id]));
    await beat(W.M1, shared); await beat(W.A1, shared); await beat(W.M1, hidden);
    await beat(W.G1, shared);
    const r = await feed(W.G1, 'w1', (p) => !!lastFor(p, shared));
    const p = lastFor(r.events, shared)!;
    expect(p.count).toBe(3);
    expect(p.viewers).toEqual([W.G1.id]);
    expect(r.text).not.toContain(hidden);
    expect(r.text).not.toContain(W.M1.id);
    expect(r.text).not.toContain(W.A1.id);
  }, 30_000);

  it('revoked guest share: the revoked issue leaves the guest\'s next snapshot while a control issue stays (stream is live)', async () => {
    const id = await mkIssue(W.M1, W.t1, 'revoked sse');
    const ctrl = await mkIssue(W.M1, W.t1, 'control sse');
    for (const i of [id, ctrl]) {
      await inWs(W.w1, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [W.w1, i, W.G1.id, W.M1.id]));
      await beat(W.M1, i);
    }
    const before = await feed(W.G1, 'w1', (p) => !!lastFor(p, id) && !!lastFor(p, ctrl));
    expect(lastFor(before.events, id)).toBeTruthy();
    expect(lastFor(before.events, ctrl)).toBeTruthy();
    await inWs(W.w1, (c) => c.query('update issue_shares set revoked_at = now() where issue_id = $1', [id]));
    const r = await feed(W.G1, 'w1', (p) => !!lastFor(p, ctrl), 4000);
    expect(lastFor(r.events, ctrl)).toBeTruthy(); // the stream delivered its snapshot: absence of the revoked issue is meaningful
    expect(r.text).not.toContain(id);
  }, 30_000);
});
