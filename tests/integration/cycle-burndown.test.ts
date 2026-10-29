import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import { cycleBurndown } from "../../src/lib/resources/cycle-burndown";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("cycle burndown API", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "";
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const get = (user: string, id: string, on: string, slug = seed.a.slug) =>
    cycleBurndown(new Request(`http://x/api?on=${on}`, { headers: { "x-u": user } }), slug, id);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'BDA', 'BDA')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("replays audit events per day, null after `on`, tolerant of no history, 422 on bad `on`, 404 across tenants", async () => {
    const cy = randomUUID(), empty = randomUUID(), a = randomUUID(), b = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cy}, ${seed.a.id}, ${teamA}, 'bd', '2040-01-01', '2040-01-05'), (${empty}, ${seed.a.id}, ${teamA}, 'bd-empty', '2040-02-01', '2040-02-03')`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, cycle_id, created_at, updated_at) values
        (${a}, ${seed.a.id}, ${teamA}, 60, 'a', 'done', 'a0', ${seed.a.member}, ${cy}, '2039-12-30T10:00:00Z', '2040-01-02T10:00:00Z'),
        (${b}, ${seed.a.id}, ${teamA}, 61, 'b', 'todo', 'a1', ${seed.a.member}, ${cy}, '2039-12-30T10:00:00Z', '2039-12-30T10:00:00Z')`;
      await tx`insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff, created_at) values
        (${randomUUID()}, ${seed.a.id}, ${seed.a.member}, 'issue', ${a}, 'update', ${tx.json({ status: { before: "todo", after: "done" } } as never)}, '2040-01-02T10:00:00Z')`;
    });
    const r = await get(seed.a.member, cy, "2040-01-03");
    expect(r.status).toBe(200);
    const { points } = await r.json();
    expect(points).toHaveLength(5);
    expect(points.map((p: { scope: number | null; done: number | null }) => [p.scope, p.done])).toEqual([[2, 0], [2, 1], [2, 1], [null, null], [null, null]]);
    expect(points.map((p: { ideal: number }) => p.ideal)).toEqual([2, 1.5, 1, 0.5, 0]);
    const e = await (await get(seed.a.member, empty, "2040-02-03")).json();
    expect(e.points).toEqual([0, 1, 2].map((k) => ({ day: `2040-02-0${k + 1}`, scope: 0, done: 0, remaining: 0, ideal: 0 })));
    expect((await get(seed.a.member, cy, "nope")).status).toBe(422);
    expect((await get(seed.a.member, cy, "2026-13-45")).status).toBe(422);
    expect((await get(seed.a.member, cy, "2040-02-30")).status).toBe(422);
    const long = randomUUID();
    await asOwner(seed.a.id, async (tx) => { await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${long}, ${seed.a.id}, ${teamA}, 'bd-long', '2041-01-01', '2041-12-31')`; });
    expect((await get(seed.a.member, long, "2041-01-03")).status).toBe(422);
    expect((await get(seed.a.member, cy, "2040-01-03", seed.b.slug)).status).toBe(404);
  });
  it("uses snapshots where present (replay only before them), reports scopeChange, writes today's snapshot lazily and idempotently", async () => {
    const cy = randomUUID(), a = randomUUID(), b = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cy}, ${seed.a.id}, ${teamA}, 'bd-snap', '2042-01-01', '2042-01-05')`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, cycle_id, created_at, updated_at) values
        (${a}, ${seed.a.id}, ${teamA}, 70, 'a', 'todo', 'a0', ${seed.a.member}, ${cy}, '2041-12-30T10:00:00Z', '2041-12-30T10:00:00Z'),
        (${b}, ${seed.a.id}, ${teamA}, 71, 'b', 'todo', 'a1', ${seed.a.member}, ${cy}, '2041-12-30T10:00:00Z', '2041-12-30T10:00:00Z')`;
      // Snapshots only for days 3 and 4: scope 4 then 3, done 1 then 2. Days 1-2 come from the audit replay (scope 2).
      await tx`insert into cycle_snapshots (cycle_id, workspace_id, day, scope, started, completed) values
        (${cy}, ${seed.a.id}, '2042-01-03', 4, 0, 1), (${cy}, ${seed.a.id}, '2042-01-04', 3, 0, 2)`;
    });
    const j = await (await get(seed.a.member, cy, "2042-01-04")).json();
    expect(j.points.map((p: { scope: number | null; done: number | null }) => [p.scope, p.done])).toEqual([[2, 0], [2, 0], [4, 1], [3, 2], [null, null]]);
    expect(j.points[2].remaining).toBe(3);
    expect(j.points[0].ideal).toBe(2);
    expect(j.scopeChange).toEqual([{ day: "2042-01-01", delta: 0 }, { day: "2042-01-02", delta: 0 }, { day: "2042-01-03", delta: 2 }, { day: "2042-01-04", delta: -1 }, { day: "2042-01-05", delta: null }]);

    // A cycle running today gets today's snapshot written on read, once, and it reflects live issues.
    const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const live = randomUUID(), c = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${live}, ${seed.a.id}, ${teamA}, 'bd-live', ${day(-1)}, ${day(1)})`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, status, sort_key, created_by, cycle_id) values (${c}, ${seed.a.id}, ${teamA}, 72, 'c', 'done', 'a2', ${seed.a.member}, ${live})`;
    });
    const count = () => asOwner(seed.a.id, (tx) => tx`select scope, completed from cycle_snapshots where cycle_id = ${live} and day = ${day(0)}::date`);
    expect(await count()).toHaveLength(0);
    const r1 = await (await get(seed.a.member, live, day(0))).json();
    const rows = await count();
    expect(rows).toHaveLength(1);
    expect([rows[0]!.scope, rows[0]!.completed]).toEqual([1, 1]);
    expect(r1.points[1]).toMatchObject({ day: day(0), scope: 1, done: 1, remaining: 0 });
    await get(seed.a.member, live, day(0));
    expect(await count()).toHaveLength(1);

    // Fully snapshotted cycles skip the replay, so the 120-day cap does not apply to them.
    const longc = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${longc}, ${seed.a.id}, ${teamA}, 'bd-long-snap', '2043-01-01', '2043-12-31')`;
      await tx`insert into cycle_snapshots (cycle_id, workspace_id, day, scope, started, completed) select ${longc}, ${seed.a.id}, d::date, 5, 0, 1 from generate_series('2043-01-01'::date, '2043-01-03'::date, '1 day') d`;
    });
    expect((await get(seed.a.member, longc, "2043-01-03")).status).toBe(200);
    expect((await get(seed.a.member, longc, "2043-01-04")).status).toBe(422);
  });
});
