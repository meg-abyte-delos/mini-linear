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
});
