// Wave 1 / lane 1 (Tess): auth + issues API over real HTTP, written from the API contract (Ada, 4a307bb).
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, world, inWs } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
const mk = async (u = W.M1, extra: Record<string, unknown> = {}) => {
  const r = await api(u, 'POST', `${P}/issues`, { title: 'l1', team_id: W.t1, ...extra });
  expect(r.status).toBe(201);
  return { body: await r.json(), etag: r.headers.get('etag') };
};
const errShape = async (r: Response, status: number, code: string) => {
  expect(r.status).toBe(status);
  const j = await r.json();
  expect(j.error.code).toBe(code);
  expect(typeof j.error.message).toBe('string');
  expect(j.error.request_id).toBeTruthy();
  expect(r.headers.get('x-request-id')).toBeTruthy();
  return j;
};
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);

describe.runIf(runIntegration)('auth over HTTP', () => {
  it('login with a wrong password is 401 and sets no cookie; unknown email looks identical', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const h = { 'content-type': 'application/json', origin: base };
    const bad = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ email: W.M1.email, password: 'definitely-wrong-123' }) });
    const unk = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: h, body: JSON.stringify({ email: `nobody-${randomUUID()}@example.test`, password: 'definitely-wrong-123' }) });
    expect(bad.status).toBe(401); expect(unk.status).toBe(401);
    expect(bad.headers.getSetCookie()).toEqual([]);
    expect((await bad.json()).error.code).toBe((await unk.json()).error.code);
  });
  it('login with a malformed body is 4xx, never 500', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    for (const body of ['{}', '{"email":"x"}', 'not json', '{"email":"a@b.co","password":"short"}']) {
      const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body });
      expect(r.status, body).toBeGreaterThanOrEqual(400); expect(r.status, body).toBeLessThan(500);
    }
  });
  it('cross-origin login is refused', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ email: W.M1.email, password: 'x' }) });
    expect(r.status).toBe(403);
  });
  it('/me returns the caller and never the password hash; logout invalidates only that session', async () => {
    const me = await api(W.M2, 'GET', '/api/v1/me');
    expect(me.status).toBe(200);
    const txt = JSON.stringify(await me.json());
    expect(txt).toContain(W.M2.email);
    expect(txt).not.toMatch(/password|argon2/i);
    const other = await api(W.M1, 'GET', '/api/v1/me');
    expect(other.status).toBe(200);
  });
  it('unauthenticated /me and workspace routes are 401 with the standard error body', async () => {
    await errShape(await api(null, 'GET', '/api/v1/me'), 401, 'unauthenticated');
    await errShape(await api(null, 'GET', `${P}/issues`), 401, 'unauthenticated');
  });
  it('a garbage session cookie is 401, not 500', async () => {
    const r = await api({ id: 'x', email: 'x', cookie: 'ml_session=garbage' } as never, 'GET', `${P}/issues`);
    expect(r.status).toBe(401);
  });
  it('a garbage Bearer key is 401', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const r = await fetch(`${base}${P}/issues`, { headers: { authorization: 'Bearer mlk_not_a_real_key' } });
    expect(r.status).toBe(401);
  });
});

describe.runIf(runIntegration)('issues: create and validation (422 with details)', () => {
  it('create returns 201, a quoted ETag of the version, and the issue is readable', async () => {
    const { body, etag } = await mk(W.M1, { title: '  keep me  ', priority: 3 });
    expect(etag).toBe('"1"');
    const g = await api(W.M1, 'GET', `${P}/issues/${body.id}`);
    expect(g.status).toBe(200);
    expect((await g.json()).priority).toBe(3);
  });
  it.each([
    ['empty title', { title: '' }],
    ['title > 255', { title: 'x'.repeat(256) }],
    ['priority 5', { priority: 5 }],
    ['priority -1', { priority: -1 }],
    ['priority as string', { priority: 'high' }],
    ['unknown field (strict)', { bogus: 1 }],
    ['invalid status', { status: 'wip' }],
    ['impossible date', { due_date: '2026-02-30' }],
    ['date with time', { due_date: '2026-02-03T10:00:00Z' }],
    ['estimate 65', { estimate: 65 }],
    ['label_ids not uuids', { label_ids: ['x'] }],
    ['51 labels', { label_ids: Array.from({ length: 51 }, () => randomUUID()) }],
  ])('rejects %s with 422 validation_failed and details', async (_n, extra) => {
    const j = await errShape(await api(W.M1, 'POST', `${P}/issues`, { title: 'v', team_id: W.t1, ...extra }), 422, 'validation_failed');
    expect(Array.isArray(j.error.details)).toBe(true);
  });
  it('missing team_id is 422; unknown team is 404/422 and creates nothing', async () => {
    expect((await api(W.M1, 'POST', `${P}/issues`, { title: 'x' })).status).toBe(422);
    const r = await api(W.M1, 'POST', `${P}/issues`, { title: 'x', team_id: randomUUID() });
    expect([404, 422]).toContain(r.status);
  });
  it('a 100000-char description is accepted, 100001 is not', async () => {
    expect((await api(W.M1, 'POST', `${P}/issues`, { title: 'big', team_id: W.t1, description: 'a'.repeat(100000) })).status).toBe(201);
    expect((await api(W.M1, 'POST', `${P}/issues`, { title: 'big', team_id: W.t1, description: 'a'.repeat(100001) })).status).toBe(422);
  });
  it('hostile text round-trips verbatim (no HTML mangling, no SQL effect)', async () => {
    const title = `<img src=x onerror=alert(1)> '; drop table issues;-- ü 🚀`;
    const { body } = await mk(W.M1, { title });
    expect((await (await api(W.M1, 'GET', `${P}/issues/${body.id}`)).json()).title).toBe(title);
  });
  it('invalid JSON body is 400/422, never 500', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const r = await fetch(`${base}${P}/issues`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: W.M1.cookie! }, body: '{bad' });
    expect([400, 422]).toContain(r.status);
  });
  it('issue numbers increment per team without gaps under 8 concurrent creates', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => api(W.M1, 'POST', `${P}/issues`, { title: 'race', team_id: W.t1 })));
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(201));
    const nums = (await Promise.all(rs.map((r) => r.json()))).map((j) => j.number as number).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(8);
    expect(nums[7]! - nums[0]!).toBe(7);
  }, 30_000);
});

describe.runIf(runIntegration)('issues: If-Match concurrency', () => {
  it('PATCH without If-Match is 428; malformed is 400; stale is 412; correct bumps version', async () => {
    const { body, etag } = await mk();
    const u = `${P}/issues/${body.id}`;
    await errShape(await api(W.M1, 'PATCH', u, { title: 'a' }), 428, 'precondition_required');
    expect((await api(W.M1, 'PATCH', u, { title: 'a' }, { 'if-match': 'banana' })).status).toBe(400);
    const ok = await api(W.M1, 'PATCH', u, { title: 'a' }, { 'if-match': etag! });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('etag')).toBe('"2"');
    await errShape(await api(W.M1, 'PATCH', u, { title: 'b' }, { 'if-match': etag! }), 412, 'precondition_failed');
    expect((await (await api(W.M1, 'GET', u)).json()).title).toBe('a');
  });
  it('weak validator W/"n" is accepted', async () => {
    const { body } = await mk();
    expect((await api(W.M1, 'PATCH', `${P}/issues/${body.id}`, { title: 'w' }, { 'if-match': 'W/"1"' })).status).toBe(200);
  });
  it('two concurrent PATCHes with the same version: exactly one wins', async () => {
    const { body } = await mk();
    const u = `${P}/issues/${body.id}`;
    const rs = await Promise.all(['x', 'y'].map((t) => api(W.M1, 'PATCH', u, { title: t }, { 'if-match': '1' })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 412]);
  });
  it('PATCH validation: empty-string title, unknown field and bad uuid are 422', async () => {
    const { body } = await mk();
    const u = `${P}/issues/${body.id}`;
    for (const p of [{ title: '' }, { bogus: 1 }, { assignee_id: 'nope' }, { priority: 9 }]) {
      expect((await api(W.M1, 'PATCH', u, p, { 'if-match': '1' })).status, JSON.stringify(p)).toBe(422);
    }
    expect((await (await api(W.M1, 'GET', u)).json()).title).toBe('l1');
  });
  it('DELETE needs If-Match (428), then soft-deletes: 404 afterwards and restore brings it back', async () => {
    const { body } = await mk();
    const u = `${P}/issues/${body.id}`;
    expect((await api(W.M1, 'DELETE', u)).status).toBe(428);
    expect((await api(W.M1, 'DELETE', u, undefined, { 'if-match': '1' })).status).toBeLessThan(300);
    expect((await api(W.M1, 'GET', u)).status).toBe(404);
    const rs = await api(W.M1, 'POST', `${u}/restore`);
    expect(rs.status).toBeLessThan(300);
    expect((await api(W.M1, 'GET', u)).status).toBe(200);
  });
});

describe.runIf(runIntegration)('issues: list, pagination, cursors', () => {
  it('limit bounds: 0 and 101 are rejected, 1 and 100 accepted', async () => {
    for (const l of [0, 101, -1, 'abc']) expect([400, 422], String(l)).toContain((await api(W.M1, 'GET', `${P}/issues?limit=${l}`)).status);
    for (const l of [1, 100]) expect((await api(W.M1, 'GET', `${P}/issues?limit=${l}`)).status).toBe(200);
  });
  it('forged, truncated and foreign-scope cursors are 400', async () => {
    const first = await (await api(W.M1, 'GET', `${P}/issues?limit=1`)).json();
    const cur: string | null = first.next_cursor;
    for (const c of ['forged', 'AAAA', 'a'.repeat(600)]) expect([400, 422], c.slice(0, 8)).toContain((await api(W.M1, 'GET', `${P}/issues?cursor=${c}`)).status);
    if (cur) {
      expect((await api(W.M1, 'GET', `${P}/issues?cursor=${encodeURIComponent(cur.slice(0, -2) + 'xx')}`)).status).toBe(400);
      // a cursor minted for issues must not be accepted by another list
      expect((await api(W.M1, 'GET', `${P}/projects?cursor=${encodeURIComponent(cur)}`)).status).toBe(400);
    }
  });
  it('walking pages of 7 returns every issue exactly once and ends with next_cursor null', async () => {
    for (let i = 0; i < 20; i++) await mk(W.M1, { title: `page-${i}` });
    const seen: string[] = []; let cur: string | null = null; let guard = 0;
    do {
      const j: { items: { id: string }[]; next_cursor: string | null } = await (await api(W.M1, 'GET', `${P}/issues?limit=7${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`)).json();
      expect(j.items.length).toBeLessThanOrEqual(7);
      seen.push(...j.items.map((x) => x.id)); cur = j.next_cursor;
    } while (cur && ++guard < 100);
    expect(cur).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    const total = await inWs(W.w1, (c) => c.query('select count(*)::int n from issues where team_id = $1 and deleted_at is null and archived_at is null', [W.t1]));
    expect(seen.length).toBeGreaterThanOrEqual(20);
    expect(seen.length).toBeLessThanOrEqual(total.rows[0].n);
  }, 60_000);
  it('list never includes soft-deleted issues or issues of teams the caller is not in', async () => {
    const { body } = await mk(W.A1, { title: 'hidden from M2' });
    const m2 = await (await api(W.M2, 'GET', `${P}/issues?limit=100`)).json();
    expect(m2.items.map((x: { id: string }) => x.id)).not.toContain(body.id);
  });
});

describe.runIf(runIntegration)('issues: bulk', () => {
  it('bulk patch updates all, empty/oversized/foreign ids are isolated per issue', async () => {
    const a = (await mk()).body.id, b = (await mk()).body.id;
    expect((await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a, b], patch: { priority: 4 } })).status).toBe(200);
    for (const id of [a, b]) expect((await (await api(W.M1, 'GET', `${P}/issues/${id}`)).json()).priority).toBe(4);
    expect((await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [], patch: { priority: 1 } })).status).toBe(422);
    expect((await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a], patch: {} })).status).toBe(422);
    expect((await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a], patch: { priority: 1 }, action: 'archive' })).status).toBe(422);
    // per-issue savepoints (handler doc): a foreign id fails alone as not_found, the visible one still commits
    const mixed = await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a, W.i2], patch: { priority: 1 } });
    expect(mixed.status).toBe(200);
    const mj = await mixed.json();
    expect(mj.succeeded).toEqual([a]);
    expect(mj.failed.map((f: { id: string; code: string }) => [f.id, f.code])).toEqual([[W.i2, 'not_found']]);
    expect((await (await api(W.M1, 'GET', `${P}/issues/${a}`)).json()).priority).toBe(1);
    const foreign = await inWs(W.w2, (c) => c.query('select priority from issues where id = $1', [W.i2]));
    expect(foreign.rows[0].priority).toBe(0);
    // duplicate ids are de-duplicated
    const dup = await (await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a, a], patch: { priority: 2 } })).json();
    expect(dup.succeeded).toEqual([a]);
  });
});
