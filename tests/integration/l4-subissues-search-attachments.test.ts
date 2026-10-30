// Lane 4 (Tess): sub-issues, search, attachments over real HTTP. Written from the contract (Ada's mini-linear-contract.md and the
// migrations: 0001 parent trigger, 0007 search, 0104 attachments), not from the handlers. Own workspace slugs per run: no clash with world().
// No teardown: each run leaves its workspaces and the 500-row attachment seed behind. Intended for a throwaway CI database only.
// Open bugs are pinned with it.fails; each BUG comment needs its ticket id once filed (hidden-parent 201 is an authz gap: cross-team existence leak, High).
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, inWs, loginAs, PW, type U } from './helpers/world';
import { hashPassword } from '../../src/lib/auth/password';
import { runIntegration } from './helpers/gate';

vi.setConfig({ testTimeout: 30_000 }); // each request creates issues on a shared, busy CI box: 5s default is too tight (observed flakes)
const slug = `l4${randomUUID().slice(0, 8)}`;
const P = `/api/v1/w/${slug}`;
let ws = '', teamA = '', teamB = '';
let A1: U, M1: U, M2: U, G1: U, N: U; // admin (teamA), member (teamA), member (teamB only), guest, registered non-member
let X: U; let XP = ''; let xIssue = ''; // a member of another workspace, its slug, one of its issues
const tag = `qz${randomUUID().slice(0, 6)}`; // unique search token
const ver = (etag: string | null) => (etag ?? '').replace(/[^0-9]/g, '');
const DQ = String.fromCharCode(34), BS = String.fromCharCode(92);

const issue = async (u: U, extra: Record<string, unknown> = {}, team = teamA) => {
  const r = await api(u, 'POST', `${P}/issues`, { title: `t ${randomUUID().slice(0, 4)}`, team_id: team, ...extra });
  return { status: r.status, body: await r.json().catch(() => ({})), etag: r.headers.get('etag') };
};
const ok = async (u: U, extra: Record<string, unknown> = {}, team = teamA) => { const x = await issue(u, extra, team); expect(x.status, JSON.stringify(x.body)).toBe(201); return x; };
const patch = async (u: U, id: string, body: unknown) => {
  const g = await api(u, 'GET', `${P}/issues/${id}`);
  return api(u, 'PATCH', `${P}/issues/${id}`, body, { 'if-match': ver(g.headers.get('etag')) });
};
const ids = (j: unknown) => ((Array.isArray(j) ? j : (j as { items: { id: string }[] }).items) as { id: string }[]).map((x) => x.id);
const children = async (u: U, id: string) => ids(await (await api(u, 'GET', `${P}/issues/${id}/children`)).json());
const mkUser = async (c: import('pg').PoolClient, tagName: string, role: string, w: string, h: string): Promise<U> => {
  const u = { id: randomUUID(), email: `${tagName}-${slug}@example.test` } as U;
  await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [u.id, u.email, h]);
  if (role) await c.query('insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,$4)', [randomUUID(), w, u.id, role]);
  return u;
};
async function mkMemberInTeamA(): Promise<U> {
  const h = await hashPassword(PW); let u!: U;
  await inWs(ws, async (c) => { u = await mkUser(c, `mx${randomUUID().slice(0, 4)}`, 'member', ws, h); await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3)', [ws, teamA, u.id]); });
  u.cookie = await loginAs(u.email); return u;
}

beforeAll(async () => {
  if (!runIntegration) return;
  const h = await hashPassword(PW);
  ws = randomUUID(); teamA = randomUUID(); teamB = randomUUID();
  await inWs(ws, async (c) => {
    await c.query('insert into workspaces (id, slug, name) values ($1,$2,$2)', [ws, slug]);
    A1 = await mkUser(c, 'a1', 'admin', ws, h); M1 = await mkUser(c, 'm1', 'member', ws, h);
    M2 = await mkUser(c, 'm2', 'member', ws, h); G1 = await mkUser(c, 'g1', 'guest', ws, h); N = await mkUser(c, 'n', '', ws, h);
    await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4), ($5,$2,$6,$7)', [teamA, ws, 'Alpha', 'ALP', teamB, 'Beta', 'BET']);
    await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3), ($1,$2,$4), ($1,$5,$6)', [ws, teamA, A1.id, M1.id, teamB, M2.id]);
  });
  const xws = randomUUID(), xt = randomUUID(); XP = `l4x${randomUUID().slice(0, 8)}`;
  await inWs(xws, async (c) => {
    await c.query('insert into workspaces (id, slug, name) values ($1,$2,$2)', [xws, XP]);
    X = await mkUser(c, 'x1', 'member', xws, h);
    await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4)', [xt, xws, 'Ext', 'EXT']);
    await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3)', [xws, xt, X.id]);
  });
  for (const u of [A1, M1, M2, G1, N, X]) u.cookie = await loginAs(u.email);
  const xi = await api(X, 'POST', `/api/v1/w/${XP}/issues`, { title: `${tag} foreign secret`, team_id: xt });
  expect(xi.status).toBe(201); xIssue = (await xi.json()).id;
}, 90_000);

describe.runIf(runIntegration)('sub-issues (parent_id)', () => {
  it('create with parent_id returns 201 and the child appears in the parent children list', async () => {
    const p = await ok(M1); const c = await ok(M1, { parent_id: p.body.id });
    expect(c.body.parent_id).toBe(p.body.id);
    const r = await api(M1, 'GET', `${P}/issues/${p.body.id}/children`);
    expect(r.status).toBe(200);
    expect(ids(await r.json())).toContain(c.body.id);
  });
  it('a parent without children has an empty children list', async () => {
    const p = await ok(M1);
    expect(await children(M1, p.body.id)).toEqual([]);
  });
  it('detaching with parent_id null removes the child from the list', async () => {
    const p = await ok(M1); const c = await ok(M1, { parent_id: p.body.id });
    const r = await patch(M1, c.body.id, { parent_id: null });
    expect(r.status).toBe(200); expect((await r.json()).parent_id).toBeNull();
    expect(await children(M1, p.body.id)).not.toContain(c.body.id);
  });
  it('re-parenting moves the child between parents', async () => {
    const p1 = await ok(M1), p2 = await ok(M1), c = await ok(M1, { parent_id: p1.body.id });
    expect((await patch(M1, c.body.id, { parent_id: p2.body.id })).status).toBe(200);
    expect(await children(M1, p1.body.id)).not.toContain(c.body.id);
    expect(await children(M1, p2.body.id)).toContain(c.body.id);
  });
  it('an issue cannot be its own parent (422, never 500)', async () => {
    const a = await ok(M1);
    expect((await patch(M1, a.body.id, { parent_id: a.body.id })).status).toBe(422);
  });
  it('a 2-cycle (A under B, then B under A) is rejected with 422', async () => {
    const a = await ok(M1), b = await ok(M1);
    expect((await patch(M1, a.body.id, { parent_id: b.body.id })).status).toBe(200);
    expect((await patch(M1, b.body.id, { parent_id: a.body.id })).status).toBe(422);
  });
  it('a long cycle (A>B>C, then A under C) is rejected with 422', async () => {
    const a = await ok(M1); const b = await ok(M1, { parent_id: a.body.id }); const c = await ok(M1, { parent_id: b.body.id });
    expect((await patch(M1, a.body.id, { parent_id: c.body.id })).status).toBe(422);
  });
  it('depth: a chain of 5 levels is accepted, a 6th level is rejected with 422', async () => {
    let prev = '';
    for (let d = 1; d <= 5; d++) { const x = await ok(M1, prev ? { parent_id: prev } : {}); prev = x.body.id; }
    expect((await issue(M1, { parent_id: prev })).status).toBe(422);
  });
  it('depth: re-parenting a 2-level subtree under a 4-level chain (6 levels) is rejected with 422', async () => {
    let deep = '';
    for (let d = 1; d <= 4; d++) { const x = await ok(M1, deep ? { parent_id: deep } : {}); deep = x.body.id; }
    const sub = await ok(M1); await ok(M1, { parent_id: sub.body.id });
    expect((await patch(M1, sub.body.id, { parent_id: deep })).status).toBe(422);
  });
  it('a nonexistent parent_id is 422 (contract A4), not 500', async () => {
    expect((await issue(M1, { parent_id: randomUUID() })).status).toBe(422);
  });
  it('a malformed parent_id is 422', async () => {
    expect((await issue(M1, { parent_id: 'not-a-uuid' })).status).toBe(422);
    expect((await issue(M1, { parent_id: 123 })).status).toBe(422);
  });
  it('a parent from ANOTHER workspace is refused and nothing is attached', async () => {
    expect((await issue(M1, { parent_id: xIssue })).status).toBe(422);
    const c = await ok(M1);
    expect((await patch(M1, c.body.id, { parent_id: xIssue })).status).toBe(422);
    expect((await (await api(M1, 'GET', `${P}/issues/${c.body.id}`)).json()).parent_id ?? null).toBeNull();
  });
  it('children of another workspace issue is 404 for us (no leak)', async () => {
    expect((await api(M1, 'GET', `${P}/issues/${xIssue}/children`)).status).toBe(404);
  });
  it('children of an issue the caller cannot see (other team) is 404', async () => {
    const hidden = await ok(A1);
    expect((await api(M2, 'GET', `${P}/issues/${hidden.body.id}/children`)).status).toBe(404);
  });
  // BUG (open, contract A4: hidden parent => 422 same as unknown): POST /issues with a parent_id the caller cannot see (other team) returns 201, attaching under a hidden issue. it.fails flips red when fixed: then switch to it().
  it.fails('a member of another team cannot attach a child under a hidden parent', async () => {
    const hidden = await ok(A1);
    const r = await issue(M2, { parent_id: hidden.body.id }, teamB);
    expect(r.status).toBe(422);
    const unk = await issue(M2, { parent_id: randomUUID() }, teamB);
    expect(r.body.error.message).toBe(unk.body.error.message); // same message as unknown: no existence leak
  });
  it('a guest cannot create sub-issues', async () => {
    const p = await ok(M1);
    expect([403, 404]).toContain((await issue(G1, { parent_id: p.body.id })).status);
  });
  it('a soft-deleted child disappears from the children list', async () => {
    const p = await ok(M1); const c = await ok(M1, { parent_id: p.body.id });
    expect([200, 204]).toContain((await api(M1, 'DELETE', `${P}/issues/${c.body.id}`, undefined, { 'if-match': ver(c.etag) })).status);
    expect(await children(M1, p.body.id)).not.toContain(c.body.id);
  });
  // BUG (open, contract A4: soft-deleted parent => 422): POST /issues under a soft-deleted parent returns 201.
  it.fails('a soft-deleted parent is refused as a new parent (422); existing children keep their parent_id', async () => {
    const p = await ok(M1); const c = await ok(M1, { parent_id: p.body.id });
    expect([200, 204]).toContain((await api(M1, 'DELETE', `${P}/issues/${p.body.id}`, undefined, { 'if-match': ver(p.etag) })).status);
    expect((await (await api(M1, 'GET', `${P}/issues/${c.body.id}`)).json()).parent_id).toBe(p.body.id);
    expect((await issue(M1, { parent_id: p.body.id })).status).toBe(422);
  });
  it('sub_issues counters on the parent: total counts direct non-deleted children, done counts status done', async () => {
    const p = await ok(M1); const a = await ok(M1, { parent_id: p.body.id }); await ok(M1, { parent_id: p.body.id, status: 'done' });
    const g = async () => (await (await api(M1, 'GET', `${P}/issues/${p.body.id}`)).json()).sub_issues;
    expect(await g()).toMatchObject({ total: 2, done: 1 });
    await api(M1, 'DELETE', `${P}/issues/${a.body.id}`, undefined, { 'if-match': ver(a.etag) });
    expect(await g()).toMatchObject({ total: 1, done: 1 });
  });
  it('relations: to self 422, duplicate pair 409 (either direction), foreign end 422, guest 403', async () => {
    const a = await ok(M1), b = await ok(M1);
    const rel = (u: U, id: string, body: unknown) => api(u, 'POST', `${P}/issues/${id}/relations`, body);
    expect((await rel(M1, a.body.id, { type: 'related', related_issue_id: a.body.id })).status).toBe(422);
    expect((await rel(M1, a.body.id, { type: 'blocks', related_issue_id: b.body.id })).status).toBe(201);
    expect((await rel(M1, a.body.id, { type: 'blocks', related_issue_id: b.body.id })).status).toBe(409);
    expect((await rel(M1, b.body.id, { type: 'related', related_issue_id: a.body.id })).status).toBe(409);
    expect((await rel(M1, a.body.id, { type: 'related', related_issue_id: xIssue })).status).toBe(422);
    expect((await rel(G1, a.body.id, { type: 'related', related_issue_id: b.body.id })).status).toBe(403);
  });
  it.todo('GET /issues/:id/sub-issues (A4 delta): pagination, include=descendants depth 1..4, 404 on hidden parent');
  it.todo('team mismatch parent/child => 422 "sub-issue must be in the parent team" (A4 delta, POST and PATCH)');
  it.todo('estimate_rollup { own, children, total } with nulls; sub_issues.in_progress (A4 delta)');
  it.todo('relation duplicate + cancel_source atomicity (A4 delta)');
  it('unauthenticated children read is 401', async () => {
    const p = await ok(M1);
    expect((await api(null, 'GET', `${P}/issues/${p.body.id}/children`)).status).toBe(401);
  });
});

describe.runIf(runIntegration)('attachments', () => {
  let I = '', SH = '';
  beforeAll(async () => {
    if (!runIntegration) return;
    I = (await ok(M1)).body.id; SH = (await ok(M1)).body.id;
    await inWs(ws, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [ws, SH, G1.id, M1.id]));
  }, 30_000);
  const add = (u: U | null, body: unknown, id = I) => api(u, 'POST', `${P}/issues/${id}/attachments`, body);
  const del = (u: U | null, aid: string, id = I) => api(u, 'DELETE', `${P}/issues/${id}/attachments/${aid}`);

  it('link: 201 with id, url, title (auto when omitted), kind=link and the creator', async () => {
    const r = await add(M1, { url: 'https://example.com/docs/spec' });
    expect(r.status).toBe(201); const j = await r.json();
    expect(j.kind).toBe('link'); expect(j.id).toBeTruthy(); expect(j.created_by).toBe(M1.id);
    expect(typeof j.title).toBe('string'); expect(j.title.length).toBeGreaterThan(0);
    expect(j.url).toContain('example.com/docs/spec');
  });
  it('explicit title is kept', async () => {
    expect((await (await add(M1, { url: 'https://example.com/x', title: 'My doc' })).json()).title).toBe('My doc');
  });
  it('file kind keeps mime_type and size_bytes (0 is valid)', async () => {
    const r = await add(M1, { kind: 'file', url: 'https://cdn.example.com/a/report.pdf', mime_type: 'application/pdf', size_bytes: 0 });
    expect(r.status).toBe(201); const j = await r.json();
    expect(j.mime_type).toBe('application/pdf'); expect(j.size_bytes).toBe(0);
  });
  it('file with no explicit title gets a title derived from the file name', async () => {
    const j = await (await add(M1, { kind: 'file', url: 'https://cdn.example.com/a/report%20v2.pdf' })).json();
    expect(j.title).toContain('report');
  });
  it.each([
    ['javascript scheme', { url: 'javascript:alert(1)' }],
    ['data scheme', { url: 'data:text/html;base64,PHNjcmlwdD4=' }],
    ['file scheme', { url: 'file:///etc/passwd' }],
    ['ftp scheme', { url: 'ftp://example.com/x' }],
    ['no scheme', { url: 'example.com/x' }],
    ['credentials in url', { url: 'https://user:pw@example.com/x' }],
    ['whitespace in url', { url: 'https://exa mple.com/x' }],
    ['empty url', { url: '' }],
    ['missing url', { title: 'no url' }],
    ['url over 2048 chars', { url: `https://example.com/${'a'.repeat(2100)}` }],
    ['title over 255 chars', { url: 'https://example.com/t', title: 'T'.repeat(256) }],
    ['blank title', { url: 'https://example.com/t', title: '   ' }],
    ['unknown kind', { url: 'https://example.com/t', kind: 'video' }],
    ['unknown field', { url: 'https://example.com/t', extra: 1 }],
    ['mime_type on a link', { url: 'https://example.com/t', mime_type: 'text/plain' }],
    ['size_bytes on a link', { url: 'https://example.com/t', size_bytes: 3 }],
    ['malformed mime_type', { kind: 'file', url: 'https://example.com/t', mime_type: 'not a mime' }],
    ['negative size', { kind: 'file', url: 'https://example.com/t', size_bytes: -1 }],
    ['fractional size', { kind: 'file', url: 'https://example.com/t', size_bytes: 1.5 }],
    ['string size', { kind: 'file', url: 'https://example.com/t', size_bytes: '10' }],
  ])('rejects %s with 422', async (_n, body) => {
    const r = await add(M1, body); expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe('validation_failed');
  });
  it('malformed JSON body is a 4xx, never 500', async () => {
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const r = await fetch(`${base}${P}/issues/${I}/attachments`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, cookie: M1.cookie! }, body: '{nope' });
    expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
  });
  it('list paginates with limit=1 in creation order, no duplicates', async () => {
    const iss = (await ok(M1)).body.id;
    for (const n of [1, 2, 3]) expect((await add(M1, { url: `https://example.com/p${n}`, title: `p${n}` }, iss)).status).toBe(201);
    const seen: string[] = []; let cur: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r = await api(M1, 'GET', `${P}/issues/${iss}/attachments?limit=1${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`);
      expect(r.status).toBe(200); const j = await r.json();
      expect(j.items.length).toBeLessThanOrEqual(1); seen.push(...j.items.map((x: { title: string }) => x.title));
      cur = j.next_cursor; if (!cur) break;
    }
    expect(seen).toEqual(['p1', 'p2', 'p3']);
  });
  it('limit out of range is 422 and a forged cursor is 400', async () => {
    expect((await api(M1, 'GET', `${P}/issues/${I}/attachments?limit=0`)).status).toBe(422);
    expect((await api(M1, 'GET', `${P}/issues/${I}/attachments?limit=101`)).status).toBe(422);
    expect((await api(M1, 'GET', `${P}/issues/${I}/attachments?cursor=forged`)).status).toBe(400);
  });
  it('a cursor from one issue is refused on another (scope bound)', async () => {
    const a = (await ok(M1)).body.id, b = (await ok(M1)).body.id;
    for (const n of [1, 2]) await add(M1, { url: `https://example.com/c${n}` }, a);
    const cur = (await (await api(M1, 'GET', `${P}/issues/${a}/attachments?limit=1`)).json()).next_cursor;
    expect(cur).toBeTruthy();
    expect((await api(M1, 'GET', `${P}/issues/${b}/attachments?cursor=${encodeURIComponent(cur)}`)).status).toBe(400);
  });
  it('delete permissions: creator yes, another member of the team 403, admin yes', async () => {
    const other = await mkMemberInTeamA();
    const a1 = await (await add(M1, { url: 'https://example.com/d1' })).json();
    const a2 = await (await add(M1, { url: 'https://example.com/d2' })).json();
    expect((await del(other, a1.id)).status).toBe(403);
    expect(ids(await (await api(M1, 'GET', `${P}/issues/${I}/attachments`)).json())).toContain(a1.id);
    expect((await del(A1, a1.id)).status).toBe(204);
    expect((await del(M1, a2.id)).status).toBe(204);
  });
  it('delete twice: the second is 404', async () => {
    const a = await (await add(M1, { url: 'https://example.com/dd' })).json();
    expect((await del(M1, a.id)).status).toBe(204);
    expect((await del(M1, a.id)).status).toBe(404);
  });
  it('delete with the attachment id under a different issue is 404', async () => {
    const a = await (await add(M1, { url: 'https://example.com/mm' })).json();
    const o = (await ok(M1)).body.id;
    expect((await del(M1, a.id, o)).status).toBe(404);
  });
  it('malformed ids are 404', async () => {
    expect((await api(M1, 'GET', `${P}/issues/nope/attachments`)).status).toBe(404);
    expect((await del(M1, 'nope')).status).toBe(404);
  });
  it('guest: can list on a shared issue, cannot add or delete (403), gets 404 on an unshared issue', async () => {
    const a = await (await add(M1, { url: 'https://example.com/g' }, SH)).json();
    expect((await api(G1, 'GET', `${P}/issues/${SH}/attachments`)).status).toBe(200);
    expect((await add(G1, { url: 'https://example.com/g2' }, SH)).status).toBe(403);
    expect((await del(G1, a.id, SH)).status).toBe(403);
    expect((await api(G1, 'GET', `${P}/issues/${I}/attachments`)).status).toBe(404);
  });
  it('team visibility: a member of another team gets 404 on list and create', async () => {
    expect((await api(M2, 'GET', `${P}/issues/${I}/attachments`)).status).toBe(404);
    expect((await add(M2, { url: 'https://example.com/h' })).status).toBe(404);
  });
  it('non-member 404, anonymous 401', async () => {
    expect((await api(N, 'GET', `${P}/issues/${I}/attachments`)).status).toBe(404);
    expect((await api(null, 'GET', `${P}/issues/${I}/attachments`)).status).toBe(401);
    expect((await add(null, { url: 'https://example.com/z' })).status).toBe(401);
  });
  it('cross-workspace: a foreign issue id on our slug is 404 and the foreign list stays empty', async () => {
    expect((await add(M1, { url: 'https://example.com/f' }, xIssue)).status).toBe(404);
    expect((await api(M1, 'GET', `${P}/issues/${xIssue}/attachments`)).status).toBe(404);
    expect((await api(M1, 'GET', `/api/v1/w/${XP}/issues/${xIssue}/attachments`)).status).toBe(404);
    expect((await (await api(X, 'GET', `/api/v1/w/${XP}/issues/${xIssue}/attachments`)).json()).items).toEqual([]);
  });
  it('creation and deletion show up in the issue activity feed', async () => {
    const iss = (await ok(M1)).body.id;
    const a = await (await add(M1, { url: 'https://example.com/act', title: 'activity-attach' }, iss)).json();
    const entries = async () => { const j = await (await api(M1, 'GET', `${P}/issues/${iss}/activity`)).json(); return (j.items ?? j) as unknown[]; };
    const mine = async () => (await entries()).filter((e) => JSON.stringify(e).includes('activity-attach'));
    const before = (await mine()).length;
    expect(before).toBeGreaterThanOrEqual(1);
    await del(M1, a.id, iss);
    expect((await mine()).length).toBeGreaterThan(before);
  });
  it('DB CHECKs back the API: javascript: url and negative size are refused at the table', async () => {
    await expect(inWs(ws, (c) => c.query("insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by) values ($1,$2,$3,'link','javascript:x','t',$4)", [randomUUID(), ws, I, M1.id]))).rejects.toThrow();
    await expect(inWs(ws, (c) => c.query("insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, size_bytes, created_by) values ($1,$2,$3,'file','https://e.com/x','t',-1,$4)", [randomUUID(), ws, I, M1.id]))).rejects.toThrow();
  });
  it('cap of 500 attachments per issue: the 501st is 422', async () => {
    const iss = (await ok(M1)).body.id;
    await inWs(ws, (c) => c.query("insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by) select gen_random_uuid(), $1, $2, 'link', 'https://e.com/' || g, 't' || g, $3 from generate_series(1, 500) g", [ws, iss, M1.id]));
    expect((await add(M1, { url: 'https://example.com/over' }, iss)).status).toBe(422);
  });
  it('create returns a Location header ending with the attachment id', async () => {
    const r = await add(M1, { url: 'https://example.com/loc' }); const j = await r.json();
    expect(r.headers.get('location') ?? '').toContain(`/attachments/${j.id}`);
  });
  it.todo('uploads (A8 delta): round trip bytes+sha256, 413 over 25MB, 415 svg/html, quota 422, second PUT 409, PUT by another user 403, content headers, path traversal in filename');
  it('hard-deleting the issue cascades its attachments', async () => {
    const iss = (await ok(M1)).body.id; const a = await (await add(M1, { url: 'https://example.com/cas' }, iss)).json();
    await inWs(ws, (c) => c.query('delete from issues where id = $1', [iss]));
    expect((await inWs(ws, (c) => c.query('select 1 from issue_attachments where id = $1', [a.id]))).rowCount).toBe(0);
  });
});

describe.runIf(runIntegration)('search', () => {
  const S = (u: U | null, qs: string) => api(u, 'GET', `${P}/search?${qs}`);
  type Hit = { kind: string; id: string; title: string; issue_id: string | null; identifier: string | null; snippet: string };
  const hits = async (r: Response) => (await r.json()).items as Hit[];
  const hid = async (r: Response) => (await hits(r)).map((x) => x.id);
  let iTitle = '', iDesc = '', iAlpha = '', iDeleted = '', iShared = '', cId = '';
  beforeAll(async () => {
    if (!runIntegration) return;
    iTitle = (await ok(M1, { title: `Zebra ${tag} kickoff` })).body.id;
    iDesc = (await ok(M1, { title: 'plain', description: `body mentions ${tag}descmatch here` })).body.id;
    iAlpha = (await ok(A1, { title: `${tag} teamalpha-only` })).body.id;
    const d = await ok(M1, { title: `${tag} to-be-deleted` }); iDeleted = d.body.id;
    expect([200, 204]).toContain((await api(M1, 'DELETE', `${P}/issues/${iDeleted}`, undefined, { 'if-match': ver(d.etag) })).status);
    iShared = (await ok(M1, { title: `${tag} sharedwithguest` })).body.id;
    await inWs(ws, (c) => c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [ws, iShared, G1.id, M1.id]));
    const cr = await api(M1, 'POST', `${P}/issues/${iTitle}/comments`, { body: `comment about ${tag}commentword` });
    expect(cr.status).toBe(201); cId = (await cr.json()).id;
  }, 60_000);

  it('finds an issue by a title word; the hit carries kind, id, title, identifier, snippet', async () => {
    const r = await S(M1, `q=${tag}`); expect(r.status).toBe(200);
    const hit = (await hits(r)).find((x) => x.id === iTitle)!; expect(hit).toBeTruthy();
    expect(hit.kind).toBe('issue'); expect(hit.title).toContain('Zebra'); expect(hit.identifier).toMatch(/^[A-Z]+-[0-9]+$/); expect(typeof hit.snippet).toBe('string');
  });
  it('matches the description and is case-insensitive', async () => {
    expect(await hid(await S(M1, `q=${tag.toUpperCase()}DESCMATCH`))).toContain(iDesc);
  });
  it('prefix match on the last token', async () => {
    expect(await hid(await S(M1, `q=${encodeURIComponent(`zebra ${tag.slice(0, 5)}`)}`))).toContain(iTitle);
  });
  it('finds a comment (kind=comment) and points to its issue', async () => {
    const h = (await hits(await S(M1, `q=${tag}commentword`))).find((x) => x.id === cId)!;
    expect(h.kind).toBe('comment'); expect(h.issue_id).toBe(iTitle);
  });
  it('kind filter restricts results; an unknown kind is 422', async () => {
    const only = await hits(await S(M1, `q=${tag}&kind=comment`)); expect(only.length).toBeGreaterThan(0); expect(only.every((x) => x.kind === 'comment')).toBe(true);
    const iss = await hits(await S(A1, `q=${tag}&kind=issue`)); expect(iss.length).toBeGreaterThan(0); expect(iss.every((x) => x.kind === 'issue')).toBe(true);
    expect((await S(M1, `q=${tag}&kind=bogus`)).status).toBe(422);
  });
  it('identifier search (e.g. ALP-3) returns the issue with that identifier', async () => {
    const ident = (await hits(await S(A1, `q=${tag}&kind=issue`))).find((x) => x.identifier)!.identifier!;
    expect((await hits(await S(A1, `q=${ident}`))).map((x) => x.identifier)).toContain(ident);
  });
  it('soft-deleted issues are not found', async () => {
    expect(await hid(await S(A1, `q=${tag}`))).not.toContain(iDeleted);
  });
  it('visibility: a member of another team does not see teamA issues; admin and teammate do', async () => {
    expect(await hid(await S(M2, `q=${tag}`))).not.toContain(iAlpha);
    expect(await hid(await S(A1, `q=${tag}`))).toContain(iAlpha);
    expect(await hid(await S(M1, `q=${tag}`))).toContain(iAlpha);
  });
  it('visibility: a guest sees only the shared issue (no projects, no unshared issues)', async () => {
    const r = await hits(await S(G1, `q=${tag}`));
    expect(r.map((x) => x.id)).toContain(iShared);
    expect(r.map((x) => x.id)).not.toContain(iTitle); expect(r.map((x) => x.id)).not.toContain(iAlpha);
    expect(r.some((x) => x.kind === 'project')).toBe(false);
  });
  it('no cross-workspace leak, and the foreign slug is 404 for us', async () => {
    expect(await hid(await S(A1, `q=${tag}`))).not.toContain(xIssue);
    expect((await api(M1, 'GET', `/api/v1/w/${XP}/search?q=${tag}`)).status).toBe(404);
    expect(await hid(await api(X, 'GET', `/api/v1/w/${XP}/search?q=${tag}`))).toContain(xIssue);
  });
  it.each([['missing q', ''], ['empty q', 'q='], ['blank q', 'q=%20%20%20'], ['q over 200 chars', `q=${'a'.repeat(201)}`]])('%s is 422', async (_n, qs) => {
    const r = await S(M1, qs); expect(r.status).toBe(422); expect((await r.json()).error.code).toBe('validation_failed');
  });
  it('q of exactly 200 chars is accepted', async () => {
    expect((await S(M1, `q=${'a'.repeat(200)}`)).status).toBe(200);
  });
  it.each([
    ['single quote', "it's"], ['double quote', DQ + 'unclosed'], ['tsquery operators', '& | ! ( ) : * <->'], ['only operators', '&&&'], ['trailing colon star', 'abc:*'],
    ['backslash', 'a' + BS + 'b' + BS], ['percent and underscore', '100%_off'], ['sql injection', "'; drop table issues; --"], ['dash prefix', '-foo -bar'], ['or keyword', 'or'],
    ['emoji', '\u{1F642}\u{1F642}'], ['cjk', '\u691C\u7D22\u30C6\u30B9\u30C8'], ['very long token', 'x'.repeat(190)], ['quoted phrase', DQ + 'zebra kickoff' + DQ],
  ])('special query (%s) never 5xx; 200 gives items[]', async (_n, q) => {
    const r = await S(M1, `q=${encodeURIComponent(q)}`);
    expect(r.status, q).toBeLessThan(500);
    if (r.status === 200) expect(Array.isArray((await r.json()).items)).toBe(true); else expect([400, 422]).toContain(r.status);
  });
  // BUG (open): GET /search?q=a%00b returns 500 (Postgres rejects NUL in text; the zod query does not strip/reject it). it.fails flips red when fixed.
  it('a NUL byte in q is a 4xx or an empty result, never 5xx', async () => {
    expect((await S(M1, 'q=a%00b')).status).toBeLessThan(500);
  });
  it('after the injection attempt the tables are intact', async () => {
    await S(M1, `q=${encodeURIComponent("'; drop table issues; --")}`);
    expect((await api(M1, 'GET', `${P}/issues/${iTitle}`)).status).toBe(200);
  });
  it('no match returns 200, items [] and next_cursor null', async () => {
    const j = await (await S(M1, `q=nomatch${randomUUID().replace(/-/g, '')}`)).json();
    expect(j.items).toEqual([]); expect(j.next_cursor).toBeNull();
  });
  it('limit bounds: 0 and 101 are 422; 100 accepted', async () => {
    expect((await S(M1, `q=${tag}&limit=0`)).status).toBe(422); expect((await S(M1, `q=${tag}&limit=101`)).status).toBe(422);
    expect((await S(M1, `q=${tag}&limit=100`)).status).toBe(200);
  });
  it('pagination: limit=1 walks all hits exactly once and equals the unpaginated set', async () => {
    const all = await hid(await S(A1, `q=${tag}&limit=100`));
    expect(all.length).toBeGreaterThanOrEqual(4);
    const seen: string[] = []; let cur: string | null = null;
    for (let i = 0; i < all.length + 3; i++) {
      const r = await S(A1, `q=${tag}&limit=1${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`); expect(r.status).toBe(200);
      const j = await r.json(); expect(j.items.length).toBeLessThanOrEqual(1); seen.push(...j.items.map((x: { id: string }) => x.id));
      cur = j.next_cursor; if (!cur) break;
    }
    expect(new Set(seen).size).toBe(seen.length); expect([...seen].sort()).toEqual([...all].sort());
  });
  it('a forged or foreign-workspace cursor is 400', async () => {
    expect((await S(A1, `q=${tag}&cursor=forged`)).status).toBe(400);
    const xc = (await (await api(X, 'GET', `/api/v1/w/${XP}/search?q=${tag}&limit=1`)).json()).next_cursor;
    if (xc) expect((await S(A1, `q=${tag}&cursor=${encodeURIComponent(xc)}`)).status).toBe(400);
  });
  it('filters: status narrows results; invalid status / uuid are 422', async () => {
    expect(await hid(await S(A1, `q=${tag}&kind=issue&status=done`))).not.toContain(iTitle);
    expect(await hid(await S(A1, `q=${tag}&kind=issue&status=backlog`))).toContain(iTitle);
    expect((await S(A1, `q=${tag}&status=nope`)).status).toBe(422);
    expect((await S(A1, `q=${tag}&team_id=nope`)).status).toBe(422);
  });
  it('team_id filter narrows to that team', async () => {
    expect(await hits(await S(A1, `q=${tag}&kind=issue&team_id=${teamB}`))).toEqual([]);
    const inB = await ok(M2, { title: `${tag} teamb-hit` }, teamB);
    expect(await hid(await S(A1, `q=${tag}&kind=issue&team_id=${teamB}`))).toContain(inB.body.id);
    expect(await hid(await S(A1, `q=${tag}&kind=issue&team_id=${teamA}`))).not.toContain(inB.body.id);
  });
  it('the index is live: a renamed issue stops matching its old title', async () => {
    const x = await ok(M1, { title: `${tag}before` });
    expect(await hid(await S(M1, `q=${tag}before`))).toContain(x.body.id);
    expect((await patch(M1, x.body.id, { title: `${tag}after` })).status).toBe(200);
    expect(await hid(await S(M1, `q=${tag}before`))).not.toContain(x.body.id);
    expect(await hid(await S(M1, `q=${tag}after`))).toContain(x.body.id);
  });
  it('an identifier query ranks that issue first', async () => {
    const all = await hits(await S(A1, `q=${tag}&kind=issue&limit=100`)); const ident = all.find((x) => x.id === iAlpha)!.identifier!;
    const first = (await hits(await S(A1, `q=${encodeURIComponent(ident)}`)))[0]!;
    expect(first.identifier).toBe(ident);
  });
  it('snippet highlights the match with <mark>', async () => {
    const h = (await hits(await S(M1, `q=${tag}descmatch`))).find((x) => x.id === iDesc)!;
    expect(h.snippet).toContain('<mark>');
  });
  it.todo('search delta (A7): kind lists + attachment kind, new filters (priority, cycle, state, due_*, has_attachment, include_done), sort=updated cursor mismatch 400, recents API, 60 req/min 429');
  it('non-member 404, anonymous 401', async () => {
    expect((await S(N, `q=${tag}`)).status).toBe(404);
    expect((await S(null, `q=${tag}`)).status).toBe(401);
  });
});
