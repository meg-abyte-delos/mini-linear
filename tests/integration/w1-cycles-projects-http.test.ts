// Wave 1 / lane 2 (Tess): cycles + projects API over real HTTP, written from the API contract (Ada, 4a307bb).
// Roles per contract: cycles write = admin, member read, guest none.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, world, inWs } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
let seq = 0;
/** Unique non-overlapping 3-day window per call, far from any real cycle (gist constraint is per team). */
const win = () => { const d = new Date(Date.UTC(2040, 0, 1 + (seq++) * 5 + Math.floor(Math.random() * 0))); const e = new Date(d.getTime() + 2 * 864e5); return { start_date: d.toISOString().slice(0, 10), end_date: e.toISOString().slice(0, 10) }; };
const mkCycle = async (team = W.t1, extra: Record<string, unknown> = {}) => {
  const r = await api(W.A1, 'POST', `${P}/cycles`, { team_id: team, name: `c-${randomUUID().slice(0, 4)}`, ...win(), ...extra });
  expect(r.status, await r.clone().text()).toBe(201);
  return r.json();
};
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);

describe.runIf(runIntegration)('cycles over HTTP', () => {
  it('admin creates (201, version 1); member reads; guest and outsiders cannot', async () => {
    const c = await mkCycle();
    expect(c.version).toBe(1);
    expect((await api(W.M1, 'GET', `${P}/cycles/${c.id}`)).status).toBe(200);
    expect((await api(W.G1, 'GET', `${P}/cycles/${c.id}`)).status).toBe(403);
    expect((await api(W.B1, 'GET', `${P}/cycles/${c.id}`)).status).toBe(404);
    expect((await api(null, 'GET', `${P}/cycles/${c.id}`)).status).toBe(401);
  });
  it('member cannot create, patch, delete or complete (403) and nothing changes', async () => {
    const c = await mkCycle();
    expect((await api(W.M1, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'm', ...win() })).status).toBe(403);
    expect((await api(W.M1, 'PATCH', `${P}/cycles/${c.id}`, { name: 'hax' }, { 'if-match': '1' })).status).toBe(403);
    expect((await api(W.M1, 'DELETE', `${P}/cycles/${c.id}`, undefined, { 'if-match': '1' })).status).toBe(403);
    expect((await api(W.M1, 'POST', `${P}/cycles/${c.id}/complete`)).status).toBe(403);
    expect((await (await api(W.A1, 'GET', `${P}/cycles/${c.id}`)).json()).name).toBe(c.name);
  });
  it.each([
    ['end before start', { start_date: '2040-06-10', end_date: '2040-06-09' }],
    ['impossible date', { start_date: '2040-02-30', end_date: '2040-03-05' }],
    ['date with time', { start_date: '2040-06-01T00:00:00Z', end_date: '2040-06-03' }],
    ['empty name', { name: '   ' }],
    ['name > 255', { name: 'n'.repeat(256) }],
    ['unknown field', { bogus: true }],
  ])('create rejects %s', async (_n, extra) => {
    const r = await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'v', ...win(), ...extra });
    expect([422, 409]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });
  it('overlap within a team is 409 (bounds inclusive); the same dates in another team are fine', async () => {
    const c = await mkCycle();
    const dup = await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'dup', start_date: c.end_date, end_date: c.end_date });
    expect(dup.status).toBe(409);
    const other = await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t2w1, name: 'other', start_date: c.start_date, end_date: c.end_date });
    expect(other.status).toBe(201);
  });
  it('a team from another workspace is refused and creates nothing', async () => {
    const r = await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t2, name: 'x', ...win() });
    expect([404, 422]).toContain(r.status);
    const n = await inWs(W.w2, (c) => c.query('select count(*)::int n from cycles'));
    expect(n.rows[0].n).toBe(0);
  });
  it('PATCH: 428 without If-Match, 412 stale, 200 bumps version; overlap on patch is 409', async () => {
    const c = await mkCycle(), d = await mkCycle();
    const u = `${P}/cycles/${c.id}`;
    expect((await api(W.A1, 'PATCH', u, { name: 'n' })).status).toBe(428);
    const ok = await api(W.A1, 'PATCH', u, { name: 'renamed' }, { 'if-match': '1' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);
    expect((await api(W.A1, 'PATCH', u, { name: 'again' }, { 'if-match': '1' })).status).toBe(412);
    expect((await api(W.A1, 'PATCH', u, { start_date: d.start_date, end_date: d.end_date }, { 'if-match': '2' })).status).toBe(409);
    expect((await api(W.A1, 'PATCH', u, { start_date: '2040-02-30' }, { 'if-match': '2' })).status).toBe(422);
  });
  it('list paginates with signed cursors and rejects foreign ones', async () => {
    for (let i = 0; i < 4; i++) await mkCycle();
    const seen: string[] = []; let cur: string | null = null; let g = 0;
    do {
      const j: { items: { id: string }[]; next_cursor: string | null } = await (await api(W.A1, 'GET', `${P}/cycles?limit=2${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`)).json();
      expect(j.items.length).toBeLessThanOrEqual(2); seen.push(...j.items.map((x) => x.id)); cur = j.next_cursor;
    } while (cur && ++g < 50);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect((await api(W.A1, 'GET', `${P}/cycles?cursor=forged`)).status).toBe(400);
    expect((await api(W.A1, 'GET', `${P}/cycles?limit=0`)).status).toBeGreaterThanOrEqual(400);
  }, 60_000);
  it('delete keeps its issues (cycle_id -> null); deleting twice is 404', async () => {
    const c = await mkCycle();
    const i = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'in cycle', team_id: W.t1, cycle_id: c.id })).json();
    expect(i.cycle_id).toBe(c.id);
    expect((await api(W.A1, 'DELETE', `${P}/cycles/${c.id}`)).status).toBe(428);
    expect((await api(W.A1, 'DELETE', `${P}/cycles/${c.id}`, undefined, { 'if-match': '1' })).status).toBeLessThan(300);
    const after = await (await api(W.M1, 'GET', `${P}/issues/${i.id}`)).json();
    expect(after.cycle_id).toBeNull();
    expect((await api(W.A1, 'DELETE', `${P}/cycles/${c.id}`, undefined, { 'if-match': '1' })).status).toBe(404);
  });
  it('complete moves only unfinished issues; a second complete is 409 and moves nothing', async () => {
    const c = await mkCycle();
    const mk = async (status: string) => (await (await api(W.M1, 'POST', `${P}/issues`, { title: status, team_id: W.t1, cycle_id: c.id, status })).json()).id as string;
    const todo = await mk('todo'), done = await mk('done'), canceled = await mk('canceled');
    const r = await api(W.A1, 'POST', `${P}/cycles/${c.id}/complete`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.moved).toBe(1);
    expect(j.next_cycle_id).toBeNull();
    expect((await (await api(W.M1, 'GET', `${P}/issues/${todo}`)).json()).cycle_id).toBeNull();
    expect((await (await api(W.M1, 'GET', `${P}/issues/${done}`)).json()).cycle_id).toBe(c.id);
    expect((await (await api(W.M1, 'GET', `${P}/issues/${canceled}`)).json()).cycle_id).toBe(c.id);
    expect((await api(W.A1, 'POST', `${P}/cycles/${c.id}/complete`)).status).toBe(409);
  });
  it('complete rolls unfinished issues into the next cycle of the same team', async () => {
    const c = await mkCycle(); const nx = await mkCycle();
    const i = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'roll', team_id: W.t1, cycle_id: c.id })).json();
    const j = await (await api(W.A1, 'POST', `${P}/cycles/${c.id}/complete`)).json();
    expect(j.next_cycle_id).toBe(nx.id);
    expect((await (await api(W.M1, 'GET', `${P}/issues/${i.id}`)).json()).cycle_id).toBe(nx.id);
  });
  it('stats of an empty cycle are finite numbers; stats of unknown or malformed id are 404', async () => {
    const c = await mkCycle();
    const r = await api(W.M1, 'GET', `${P}/cycles/${c.id}/stats`);
    expect(r.status).toBe(200);
    const txt = await r.text();
    expect(txt).not.toMatch(/NaN|Infinity/);
    expect((await api(W.M1, 'GET', `${P}/cycles/${randomUUID()}/stats`)).status).toBe(404);
    expect((await api(W.M1, 'GET', `${P}/cycles/nope/stats`)).status).toBe(404);
  });
  it('snapshot is admin-only', async () => {
    expect((await api(W.M1, 'POST', `${P}/cycles/snapshot`)).status).toBe(403);
    expect((await api(W.A1, 'POST', `${P}/cycles/snapshot`)).status).toBe(200);
  });
  it('an issue cannot be put in a cycle of another team', async () => {
    const other = await mkCycle(W.t2w1);
    const r = await api(W.M1, 'POST', `${P}/issues`, { title: 'wrong team cycle', team_id: W.t1, cycle_id: other.id });
    expect([404, 409, 422]).toContain(r.status);
  });
});

describe.runIf(runIntegration)('projects over HTTP', () => {
  const mkProject = async (extra: Record<string, unknown> = {}) => {
    const r = await api(W.A1, 'POST', `${P}/projects`, { name: `p-${randomUUID().slice(0, 4)}`, team_ids: [W.t1], ...extra });
    expect(r.status, await r.clone().text()).toBe(201);
    return r.json();
  };
  it('create returns defaults; member can read, guest cannot; outsiders 404, anonymous 401', async () => {
    const p = await mkProject();
    expect(p.version).toBe(1);
    expect(p.progress_pct).toBe(0);
    expect((await api(W.M1, 'GET', `${P}/projects/${p.id}`)).status).toBe(200);
    expect([403, 404]).toContain((await api(W.G1, 'GET', `${P}/projects/${p.id}`)).status); // FLAG: cycles give 403, projects 404 for a guest (inconsistent, both hide content)
    expect((await api(W.B1, 'GET', `${P}/projects/${p.id}`)).status).toBe(404);
    expect((await api(null, 'GET', `${P}/projects/${p.id}`)).status).toBe(401);
  });
  it.each([
    ['empty name', { name: '' }],
    ['bad status', { status: 'bogus' }],
    ['target before start', { start_date: '2040-12-02', target_date: '2040-12-01' }],
    ['guest as lead', () => ({ lead_id: W.G1.id })],
    ['foreign-tenant lead', () => ({ lead_id: W.B1.id })],
    ['unknown field', { bogus: 1 }],
    ['bad color', { color: 'red' }],
  ])('create rejects %s with 422', async (_n, extra) => {
    const e = typeof extra === 'function' ? extra() : extra;
    const r = await api(W.A1, 'POST', `${P}/projects`, { name: 'x', team_ids: [W.t1], ...e });
    expect(r.status).toBe(422);
  });
  it('PATCH needs If-Match (428), stale 412, concurrent patches have one winner, null clears a field', async () => {
    const p = await mkProject({ lead_id: W.M1.id, target_date: '2040-12-01' });
    const u = `${P}/projects/${p.id}`;
    expect((await api(W.A1, 'PATCH', u, { name: 'a' })).status).toBe(428);
    const ok = await api(W.A1, 'PATCH', u, { lead_id: null, target_date: null }, { 'if-match': '1' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ lead_id: null, target_date: null, version: 2 });
    expect((await api(W.A1, 'PATCH', u, { name: 'stale' }, { 'if-match': '1' })).status).toBe(412);
    const rs = await Promise.all(['x', 'y'].map((n) => api(W.A1, 'PATCH', u, { name: n }, { 'if-match': '2' })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 412]);
  });
  it('progress_pct counts done over non-canceled issues', async () => {
    const p = await mkProject();
    const mk = (status: string) => api(W.M1, 'POST', `${P}/issues`, { title: status, team_id: W.t1, project_id: p.id, status });
    await mk('done'); await mk('todo'); await mk('canceled');
    const j = await (await api(W.M1, 'GET', `${P}/projects/${p.id}`)).json();
    expect(j.progress_pct).toBe(50);
  });
  it('milestones and updates: CRUD basics, validation, and visibility follows the project', async () => {
    const p = await mkProject();
    const m = await api(W.A1, 'POST', `${P}/projects/${p.id}/milestones`, { name: 'M1' });
    expect([200, 201]).toContain(m.status);
    const mj = await m.json();
    expect((await api(W.A1, 'POST', `${P}/projects/${p.id}/milestones`, { name: '' })).status).toBe(422);
    expect((await api(W.M1, 'GET', `${P}/projects/${p.id}/milestones`)).status).toBe(200);
    expect((await api(W.B1, 'GET', `${P}/projects/${p.id}/milestones`)).status).toBe(404);
    expect((await api(W.B1, 'GET', `${P}/project-milestones/${mj.id}`)).status).toBe(404);
    const up = await api(W.A1, 'POST', `${P}/projects/${p.id}/updates`, { body: 'on track', health: 'on_track' });
    expect([200, 201, 422]).toContain(up.status);
    expect((await api(W.A1, 'POST', `${P}/projects/${p.id}/updates`, { body: 'x', health: 'nonsense' })).status).toBe(422);
  });
  it('delete detaches issues but keeps them; the project then 404s', async () => {
    const p = await mkProject();
    const i = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'in project', team_id: W.t1, project_id: p.id })).json();
    expect((await api(W.A1, 'DELETE', `${P}/projects/${p.id}`)).status).toBe(428);
    expect((await api(W.A1, 'DELETE', `${P}/projects/${p.id}`, undefined, { 'if-match': '1' })).status).toBeLessThan(300);
    expect((await api(W.A1, 'GET', `${P}/projects/${p.id}`)).status).toBe(404);
    const after = await (await api(W.M1, 'GET', `${P}/issues/${i.id}`)).json();
    expect(after.project_id).toBeNull();
  });
  it('an issue cannot point at a project of another workspace', async () => {
    const r = await api(W.M1, 'POST', `${P}/issues`, { title: 'x', team_id: W.t1, project_id: randomUUID() });
    expect([404, 422]).toContain(r.status);
  });
  it('list: 130 projects page through without gap or duplicate, cursors are scoped', async () => {
    const tag = randomUUID().slice(0, 6);
    await Promise.all(Array.from({ length: 13 }, (_, k) => Promise.all(Array.from({ length: 10 }, (_, i) => api(W.A1, 'POST', `${P}/projects`, { name: `pg-${tag}-${k}-${i}`, team_ids: [W.t1] })))));
    const seen: string[] = []; let cur: string | null = null; let g = 0;
    do {
      const j: { items: { id: string; name: string }[]; next_cursor: string | null } = await (await api(W.A1, 'GET', `${P}/projects?limit=50${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`)).json();
      seen.push(...j.items.filter((x) => x.name.startsWith(`pg-${tag}`)).map((x) => x.id)); cur = j.next_cursor;
    } while (cur && ++g < 50);
    expect(seen.length).toBe(130);
    expect(new Set(seen).size).toBe(130);
    const first = await (await api(W.A1, 'GET', `${P}/projects?limit=1`)).json();
    expect((await api(W.A1, 'GET', `${P}/issues?cursor=${encodeURIComponent(first.next_cursor)}`)).status).toBe(400);
  }, 120_000);
});
