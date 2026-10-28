import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as L from "../../src/lib/resources/labels-cycles";
import * as S from "../../src/lib/resources/shares-audit";
import * as I from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("M2 review fixes", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", cycA2 = "", cycA = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const send = (fn: Fn, user: string, method: string, body: unknown, ...a: string[]) => call(fn, user, { method, body: JSON.stringify(body) }, ...a);
  const patch = (user: string, id: string, ver: number, body: unknown) => call(I.patchIssue as Fn, user, { method: "PATCH", body: JSON.stringify(body), headers: { "if-match": `"${ver}"` } }, seed.a.slug, id);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); cycA = randomUUID(); cycA2 = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG'), (${teamA2}, ${seed.a.id}, 'Ops', 'OPS')`;
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cycA}, ${seed.a.id}, ${teamA}, 'c1', '2026-01-01', '2026-01-14'), (${cycA2}, ${seed.a.id}, ${teamA2}, 'c2', '2026-01-01', '2026-01-14')`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  // request_id is per-request (S11), exclude it from body equality
  const noReq = (b: any) => { if (b?.error) { const { request_id: _r, ...e } = b.error; return { ...b, error: e }; } const { request_id: _q, ...rest } = b ?? {}; return rest; };
  it("assignee_id: non-guest member of this workspace only; same 422 for unknown, cross-tenant and guest (create + PATCH)", async () => {
    const create = (assignee_id: string) => send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "x", assignee_id }, seed.a.slug);
    const bodies = [];
    for (const bad of [randomUUID(), seed.b.member, seed.a.guest]) { const r = await create(bad); expect(r.status).toBe(422); bodies.push(noReq(await r.json())); }
    expect(bodies[1]).toEqual(bodies[0]); expect(bodies[2]).toEqual(bodies[0]); // no existence oracle
    const ok = await create(seed.a.admin); expect(ok.status).toBe(201);
    const issue = await ok.json(); expect(issue.assignee_id).toBe(seed.a.admin);
    for (const bad of [randomUUID(), seed.b.member, seed.a.guest]) {
      const r = await patch(seed.a.member, issue.id, 1, { assignee_id: bad }); expect(r.status).toBe(422); expect(noReq(await r.json())).toEqual(bodies[0]);
    }
    expect((await patch(seed.a.member, issue.id, 1, { assignee_id: seed.a.owner })).status).toBe(200);
    expect((await patch(seed.a.member, issue.id, 2, { assignee_id: null })).status).toBe(200); // unassign still fine
  });

  it("cycle must belong to the issue's team (create + PATCH); unknown cycle gives the same 422", async () => {
    const mk = (cycle_id: string) => send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "c", cycle_id }, seed.a.slug);
    expect((await mk(cycA2)).status).toBe(422);
    expect((await mk(randomUUID())).status).toBe(422);
    const ok = await mk(cycA); expect(ok.status).toBe(201);
    const issue = await ok.json();
    expect((await patch(seed.a.member, issue.id, 1, { cycle_id: cycA2 })).status).toBe(422);
    expect((await patch(seed.a.member, issue.id, 1, { cycle_id: null })).status).toBe(200);
  });

  it("guests cannot read labels or cycles (list + get); members can", async () => {
    const g = seed.a.guest, m = seed.a.member;
    expect((await call(L.listLabels as Fn, g, {}, seed.a.slug)).status).toBe(403);
    expect((await call(L.listCycles as Fn, g, {}, seed.a.slug)).status).toBe(403);
    expect((await call(L.getCycleH as Fn, g, {}, seed.a.slug, cycA)).status).toBe(403);
    expect((await call(L.getLabelH as Fn, g, {}, seed.a.slug, randomUUID())).status).toBe(403);
    expect((await call(L.listLabels as Fn, m, {}, seed.a.slug)).status).toBe(200);
    expect((await call(L.getCycleH as Fn, m, {}, seed.a.slug, cycA)).status).toBe(200);
  });

  it("audit pagination walks (created_at desc, id desc) with no skips or repeats, even when rows share created_at", async () => {
    // 7 events in ONE tx share created_at (now() is the tx start): the id tiebreaker must carry the order.
    await asOwner(seed.a.id, async (tx) => {
      for (let i = 0; i < 7; i++) await tx`insert into audit_events (id, workspace_id, entity, action) values (${randomUUID()}, ${seed.a.id}, 'tie', 'x')`;
    });
    const seen: { id: string; created_at: string }[] = []; let cursor = "", pages = 0;
    do {
      const j = await (await call(S.listAudit as Fn, seed.a.admin, { q: `?entity=tie&limit=3${cursor ? `&cursor=${cursor}` : ""}` }, seed.a.slug)).json();
      seen.push(...j.items); cursor = j.next_cursor ?? ""; pages++;
      for (const it of j.items) expect(it).not.toHaveProperty("_k");
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(7); expect(new Set(seen.map((e) => e.id)).size).toBe(7);
    const ids = seen.map((e) => e.id); expect(ids).toEqual([...ids].sort().reverse());
  });

  it("parent trigger locks the chain: concurrent re-parenting into a cycle cannot both commit", async () => {
    const mk = async () => (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "n" }, seed.a.slug)).json()).id as string;
    const [a, b] = [await mk(), await mk()];
    const move = (id: string, parent: string) => asOwner(seed.a.id, async (tx) => { await tx`update issues set parent_id = ${parent} where id = ${id}`; await new Promise((r) => setTimeout(r, 150)); });
    const res = await Promise.allSettled([move(a, b), move(b, a)]); // a->b and b->a at the same time
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1); // second one blocks on the lock, re-checks, sees the cycle (or deadlock-aborts)
    const rows = await asOwner(seed.a.id, (tx) => tx`select id, parent_id from issues where id in (${a}, ${b})`);
    expect(rows.filter((r) => r.parent_id !== null)).toHaveLength(1);
  });
});
