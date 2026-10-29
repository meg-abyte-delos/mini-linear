import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as S from "../../src/lib/resources/cycles-schedule";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("cycles schedule API", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", teamB = "";
  const call = (fn: (r: Request, ...a: string[]) => Promise<Response>, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const put = (u: string, team: string, body: unknown, v: number, slug = seed.a.slug) => call(S.putCycleSettings as never, u, { method: "PUT", body: JSON.stringify(body), headers: { "if-match": `"${v}"` } }, slug, team);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); teamB = randomUUID();
    for (const [ws, t, k] of [[seed.a.id, teamA, "CYA"], [seed.a.id, teamA2, "CYB"], [seed.b.id, teamB, "CYC"]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, ${k}, ${k})`;
    });
    await asOwner(seed.a.id, (tx) => tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`);
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("settings: defaults, admin-only upsert, optimistic version, validation", async () => {
    const g = await (await call(S.getCycleSettings as never, seed.a.member, {}, seed.a.slug, teamA)).json();
    expect(g).toMatchObject({ enabled: false, duration_days: 14, version: 0 });
    expect((await put(seed.a.member, teamA, { enabled: true }, 0)).status).toBe(403);
    expect((await put(seed.a.admin, teamA, { duration_days: 0 }, 0)).status).toBe(422);
    const r = await put(seed.a.admin, teamA, { enabled: true, duration_days: 7, upcoming_count: 3 }, 0);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ enabled: true, duration_days: 7, upcoming_count: 3, version: 1 });
    expect((await put(seed.a.admin, teamA, { cooldown_days: 1 }, 0)).status).toBe(412);
    expect((await put(seed.a.admin, teamA, { cooldown_days: 1 }, 1)).status).toBe(200);
  });

  it("members cannot see settings of a team they are not in; cross-tenant is a 404/422", async () => {
    expect((await call(S.getCycleSettings as never, seed.a.member, {}, seed.a.slug, teamA2)).status).toBe(422);
    expect((await call(S.getCycleSettings as never, seed.a.member, {}, seed.a.slug, teamB)).status).toBe(422);
  });

  it("ensure creates current + upcoming, is idempotent, names Cycle N; window returns current/next", async () => {
    const r = await call(S.ensureCycles as never, seed.a.admin, { method: "POST" }, seed.a.slug, teamA);
    const { created } = await r.json();
    expect(created.length).toBeGreaterThanOrEqual(4); // current + 3 upcoming
    expect(created[0].name).toBe("Cycle 1");
    expect((await (await call(S.ensureCycles as never, seed.a.admin, { method: "POST" }, seed.a.slug, teamA)).json()).created).toEqual([]);
    const w = await (await call(S.cycleWindow as never, seed.a.member, { q: `?team_id=${teamA}` }, seed.a.slug)).json();
    expect(w.current).not.toBeNull(); expect(w.next).not.toBeNull(); expect(w.next.start_date > w.current.end_date).toBe(true);
    expect((await call(S.ensureCycles as never, seed.a.member, { method: "POST" }, seed.a.slug, teamA)).status).toBe(403);
  });

  it("issue/cycle team guard, stats, snapshot and rollover", async () => {
    const w = await (await call(S.cycleWindow as never, seed.a.member, { q: `?team_id=${teamA}` }, seed.a.slug)).json();
    const cur = w.current.id as string, nxt = w.next.id as string;
    const mk = (team: string, n: number, status: string, cycle: string | null) => asOwner(seed.a.id, async (tx) => {
      const id = randomUUID();
      await tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, cycle_id) values (${id}, ${seed.a.id}, ${team}, ${n}, 'x', ${status}::issue_status, 'a0', ${seed.a.member}, ${cycle})`;
      return id;
    });
    await expect(mk(teamA2, 1, "todo", cur)).rejects.toThrow(/another team/);
    await mk(teamA, 1, "done", cur); await mk(teamA, 2, "in_progress", cur); await mk(teamA, 3, "todo", cur); await mk(teamA, 4, "canceled", cur);
    const st = await (await call(S.cycleStats as never, seed.a.member, {}, seed.a.slug, cur)).json();
    expect(st).toMatchObject({ scope: 3, completed: 1, started: 1, canceled: 1, percent_complete: 33 });
    expect((await (await call(S.snapshotCycles as never, seed.a.admin, { method: "POST" }, seed.a.slug)).json()).snapshotted).toBeGreaterThanOrEqual(1);
    // alias regression: a non-admin ctx must not error on the `cycles c` alias and only sees its own teams' cycles
    const n = await db().begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      return S.snapshotRunning({ tx, userId: seed.a.member, workspaceId: seed.a.id, role: "member", req: new Request("http://x/") } as never);
    });
    expect(n).toBeGreaterThanOrEqual(1);
    const st2 = await (await call(S.cycleStats as never, seed.a.member, {}, seed.a.slug, cur)).json();
    expect(st2.series.at(-1)).toMatchObject({ scope: 3, completed: 1 });
    // complete: unfinished (todo, in_progress) move to next cycle; done/canceled stay; audit per moved issue
    const ro = await (await call(S.completeCycle as never, seed.a.admin, { method: "POST" }, seed.a.slug, cur)).json();
    expect(ro).toMatchObject({ moved: 2, next_cycle_id: nxt });
    const left = await asOwner(seed.a.id, (tx) => tx`select status from issues where cycle_id = ${cur} order by status`);
    expect(left.map((x) => x.status)).toEqual(["done", "canceled"]);
    expect(await asOwner(seed.a.id, (tx) => tx`select 1 from audit_events where action = 'cycle_rollover' and diff->'cycle_id'->>'after' = ${nxt}`)).toHaveLength(2);
    // C-7 idempotence: second completion is a 409 and moves nothing
    expect((await call(S.completeCycle as never, seed.a.admin, { method: "POST" }, seed.a.slug, cur)).status).toBe(409);
    // C-6: no issue may be added to a completed cycle; non-admin cannot complete
    await expect(mk(teamA, 9, "todo", cur)).rejects.toThrow(/completed cycle/);
    expect((await call(S.completeCycle as never, seed.a.member, { method: "POST" }, seed.a.slug, nxt)).status).toBe(403);
  });

  it("C-7 no next cycle: unfinished issues return to no cycle; empty cycle completes", async () => {
    const mkc = (team: string, a: string, b: string) => asOwner(seed.a.id, async (tx) => {
      const id = randomUUID(); await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${id}, ${seed.a.id}, ${team}, 'solo', ${a}, ${b})`; return id;
    });
    const c = await mkc(teamA2, "2019-01-01", "2019-01-14"), e = await mkc(teamA2, "2019-02-01", "2019-02-14");
    const iid = randomUUID();
    await asOwner(seed.a.id, (tx) => tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, cycle_id) values (${iid}, ${seed.a.id}, ${teamA2}, 1, 'x', 'in_progress', 'a0', ${seed.a.member}, ${c})`);
    expect(await (await call(S.completeCycle as never, seed.a.admin, { method: "POST" }, seed.a.slug, c)).json()).toMatchObject({ moved: 1, next_cycle_id: e });
    expect(await (await call(S.completeCycle as never, seed.a.admin, { method: "POST" }, seed.a.slug, e)).json()).toMatchObject({ moved: 1, next_cycle_id: null }); // the rolled issue leaves again: no next cycle
    expect((await asOwner(seed.a.id, (tx) => tx`select cycle_id from issues where id = ${iid}`))[0]!.cycle_id).toBeNull();
  });

  it("C-8 empty cycle stats: finite numbers, no NaN", async () => {
    const id = (await asOwner(seed.a.id, async (tx) => { const i = randomUUID(); await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${i}, ${seed.a.id}, ${teamA}, 'empty', '2018-01-01', '2018-01-05')`; return i; }));
    const st = await (await call(S.cycleStats as never, seed.a.member, {}, seed.a.slug, id)).json();
    expect(st).toMatchObject({ scope: 0, completed: 0, percent_complete: 0, series: [] });
  });

  it("C-2 overlap is per team, bounds inclusive (adjacent day rejected by the gist constraint)", async () => {
    const ins = (team: string, a: string, b: string) => asOwner(seed.a.id, (tx) => tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${randomUUID()}, ${seed.a.id}, ${team}, 'o', ${a}, ${b})`);
    await ins(teamA2, "2031-01-01", "2031-01-14");
    await expect(ins(teamA2, "2031-01-14", "2031-01-20")).rejects.toThrow(/cycles_no_overlap/);
    await expect(ins(teamA2, "2031-01-05", "2031-01-06")).rejects.toThrow(/cycles_no_overlap/);
    await ins(teamA, "2031-01-01", "2031-01-14"); // other team, same dates
    await ins(teamA2, "2031-01-15", "2031-01-20"); // day after end is free
  });

  it("C-5 deleting a cycle keeps its issues (cycle_id -> null)", async () => {
    const c = randomUUID(), i = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${c}, ${seed.a.id}, ${teamA2}, 'd', '2032-01-01', '2032-01-05')`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by, cycle_id) values (${i}, ${seed.a.id}, ${teamA2}, 50, 'x', 'a0', ${seed.a.member}, ${c})`;
      await tx`delete from cycles where id = ${c}`;
    });
    expect((await asOwner(seed.a.id, (tx) => tx`select cycle_id from issues where id = ${i}`))[0]!.cycle_id).toBeNull();
  });
});
