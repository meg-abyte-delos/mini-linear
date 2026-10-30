import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { setSessionResolver, db } from '../../src/lib/http/ctx';
import * as P from '../../src/lib/resources/projects-comments';
import * as C from '../../src/lib/resources/labels-cycles';
import * as S from '../../src/lib/resources/cycles-schedule';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');
(haveDb ? describe : describe.skip)('A1: project health, counts and cycle percent', () => {
  const owner = ownerSql(); let seed: Seed; let teamA = '', teamB = '';
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit = {}, ...a: string[]) =>
    fn(new Request('http://x/api', { ...init, headers: { 'x-u': user, 'content-type': 'application/json' } }), ...a);
  const asOwner = <T>(fn: (tx: typeof owner) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return fn(tx as never); }) as Promise<T>;
  let n = 0;
  const mk = (team: string, status: string, o: { project?: string; cycle?: string; estimate?: number; deleted?: boolean } = {}) => asOwner(async (tx) => {
    await tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, project_id, cycle_id, estimate, deleted_at)
      values (${randomUUID()}, ${seed.a.id}, ${team}, ${++n + (team === teamB ? 1000 : 0)}, 'x', ${status}::issue_status, 'a0', ${seed.a.member}, ${o.project ?? null}, ${o.cycle ?? null}, ${o.estimate ?? null}, ${o.deleted ? new Date() : null})`;
  });
  const project = async (name: string, teams: string[], extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await asOwner(async (tx) => {
      await tx`insert into projects (id, workspace_id, name, description, status, start_date, target_date) values (${id}, ${seed.a.id}, ${name}, '', ${(extra.status as string) ?? 'in_progress'}, ${(extra.start as string) ?? null}, ${(extra.target as string) ?? null})`;
      for (const t of teams) await tx`insert into project_teams (workspace_id, project_id, team_id) values (${seed.a.id}, ${id}, ${t})`;
    });
    return id;
  };
  const get = async (user: string, id: string) => (await call(P.getProjectH as Fn, user, {}, seed.a.slug, id)).json();
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get('x-u'));
    teamA = randomUUID(); teamB = randomUUID();
    await asOwner(async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Alpha', 'ALP'), (${teamB}, ${seed.a.id}, 'Beta', 'BET')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('counts: total/done/in_progress/canceled, soft-deleted out, canceled out of the denominator', async () => {
    const p = await project('Counts', [teamA]);
    for (const s of ['done', 'done', 'in_progress', 'in_review', 'todo', 'backlog']) await mk(teamA, s, { project: p });
    await mk(teamA, 'canceled', { project: p }); await mk(teamA, 'done', { project: p, deleted: true });
    const g = await get(seed.a.member, p);
    expect(g).toMatchObject({ issues_total: 6, issue_count: 6, issues_done: 2, done_count: 2, issues_in_progress: 2, issues_canceled: 1, progress_pct: 33, progress_by_estimate: null });
  });
  it('empty project: zeros, no NaN, no computed health', async () => {
    const g = await get(seed.a.member, await project('Empty', [teamA], { target: '2026-12-01' }));
    expect(g).toMatchObject({ issues_total: 0, issues_done: 0, issues_in_progress: 0, progress_pct: 0, progress_by_estimate: null, health_computed: null });
  });
  it('estimate weighted progress ignores canceled and deleted', async () => {
    const p = await project('Est', [teamA]);
    await mk(teamA, 'done', { project: p, estimate: 3 }); await mk(teamA, 'todo', { project: p, estimate: 5 }); await mk(teamA, 'todo', { project: p });
    await mk(teamA, 'canceled', { project: p, estimate: 40 }); await mk(teamA, 'done', { project: p, estimate: 40, deleted: true });
    expect(await get(seed.a.member, p)).toMatchObject({ progress_pct: 33, progress_by_estimate: 38 });
  });
  it('health_computed: overdue and unfinished is off_track; finished project is null; posted health stays separate', async () => {
    const late = await project('Late', [teamA], { start: '2026-01-01', target: '2026-02-01' });
    await mk(teamA, 'done', { project: late }); await mk(teamA, 'todo', { project: late });
    expect(await get(seed.a.member, late)).toMatchObject({ health_computed: 'off_track', health: null });
    const done = await project('Fin', [teamA], { status: 'completed', target: '2026-02-01' });
    await mk(teamA, 'todo', { project: done });
    expect((await get(seed.a.member, done)).health_computed).toBeNull();
    const all = await project('Far', [teamA], { start: '2026-01-01', target: '2099-01-01' });
    await mk(teamA, 'todo', { project: all });
    expect((await get(seed.a.member, all)).health_computed).toBe('on_track');
  });
  it('visibility: a member never sees counts of issues in teams they are not in; admin sees all; list agrees with get', async () => {
    const p = await project('Cross', [teamA, teamB]);
    await mk(teamA, 'done', { project: p }); await mk(teamB, 'done', { project: p, estimate: 8 }); await mk(teamB, 'in_progress', { project: p }); await mk(teamB, 'canceled', { project: p });
    expect(await get(seed.a.member, p)).toMatchObject({ issues_total: 1, issues_done: 1, issues_in_progress: 0, issues_canceled: 0, progress_pct: 100, progress_by_estimate: null });
    expect(await get(seed.a.admin, p)).toMatchObject({ issues_total: 3, issues_done: 2, issues_in_progress: 1, issues_canceled: 1, progress_pct: 67, progress_by_estimate: 100 });
    const list = await (await call(P.listProjects as Fn, seed.a.member, {}, seed.a.slug)).json();
    const row = (list.items ?? list.data).find((x: { id: string }) => x.id === p);
    expect(row).toMatchObject({ issues_total: 1, progress_pct: 100 });
    expect((await call(P.getProjectH as Fn, seed.a.guest, {}, seed.a.slug, p)).status).toBe(404);
  });
  it('cycle list/get: scope excludes canceled and deleted; equals /stats; percent_complete', async () => {
    const cy = randomUUID();
    await asOwner(async (tx) => { await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cy}, ${seed.a.id}, ${teamA}, 'C1', '2030-01-01', '2030-01-14')`; });
    for (const s of ['done', 'in_progress', 'in_review', 'todo', 'canceled']) await mk(teamA, s, { cycle: cy });
    await mk(teamA, 'done', { cycle: cy, deleted: true });
    const g = await (await call(C.getCycleH as Fn, seed.a.member, {}, seed.a.slug, cy)).json();
    expect(g).toMatchObject({ scope: 4, started: 2, completed: 1, canceled: 1, percent_complete: 25 });
    const st = await (await call(S.cycleStats as never, seed.a.member, {}, seed.a.slug, cy)).json();
    expect({ scope: st.scope, started: st.started, completed: st.completed, canceled: st.canceled, percent_complete: st.percent_complete }).toEqual({ scope: g.scope, started: g.started, completed: g.completed, canceled: g.canceled, percent_complete: g.percent_complete });
    const list = await (await call(C.listCycles as Fn, seed.a.member, {}, seed.a.slug)).json();
    expect((list.items ?? list.data).find((x: { id: string }) => x.id === cy)).toMatchObject({ scope: 4, percent_complete: 25 });
    const empty = randomUUID();
    await asOwner(async (tx) => { await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${empty}, ${seed.a.id}, ${teamA}, 'C2', '2030-02-01', '2030-02-14')`; });
    expect(await (await call(C.getCycleH as Fn, seed.a.member, {}, seed.a.slug, empty)).json()).toMatchObject({ scope: 0, percent_complete: 0 });
  });
  it('cycle of a team the member is not in stays hidden (404), counts included', async () => {
    const cy = randomUUID();
    await asOwner(async (tx) => { await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cy}, ${seed.a.id}, ${teamB}, 'CB', '2030-03-01', '2030-03-14')`; });
    await mk(teamB, 'done', { cycle: cy });
    expect((await call(C.getCycleH as Fn, seed.a.member, {}, seed.a.slug, cy)).status).toBe(404);
    expect(await (await call(C.getCycleH as Fn, seed.a.admin, {}, seed.a.slug, cy)).json()).toMatchObject({ scope: 1, completed: 1, percent_complete: 100 });
  });
});
