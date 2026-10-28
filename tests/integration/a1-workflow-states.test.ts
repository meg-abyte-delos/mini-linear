import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as S from "../../src/lib/resources/workflow-states";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("workflow states, estimate, due date (Area 1 part 1)", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", teamB = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const j = (b: unknown) => JSON.stringify(b);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const states = async (user: string, team: string) => (await (await call(S.listStates as Fn, user, {}, seed.a.slug, team)).json()).items as { id: string; name: string; category: string; version: number }[];
  const newIssue = async (body: Record<string, unknown>) => call(H.createIssue as Fn, seed.a.member, { method: "POST", body: j({ team_id: teamA, title: "t", ...body }) }, seed.a.slug);
  const patch = (id: string, v: number, body: unknown, user = seed.a.member) => call(H.patchIssue as Fn, user, { method: "PATCH", body: j(body), headers: { "if-match": `"${v}"` } }, seed.a.slug, id);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); teamB = randomUUID();
    for (const [ws, t, key, m] of [[seed.a.id, teamA, "WFA", seed.a.member], [seed.a.id, teamA2, "WFB", null], [seed.b.id, teamB, "WFC", seed.b.member]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, 'Eng', ${key})`;
      if (m) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${t}, ${m})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("seeds the 6 default states for a new team, ordered, one per legacy status", async () => {
    const s = await states(seed.a.member, teamA);
    expect(s.map((x) => x.name)).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"]);
    expect(s.map((x) => x.category)).toEqual(["backlog", "unstarted", "started", "started", "completed", "canceled"]);
  });

  it("hides states of teams the caller cannot see (404, no oracle) and across tenants", async () => {
    expect((await call(S.listStates as Fn, seed.a.member, {}, seed.a.slug, teamA2)).status).toBe(404);
    expect((await call(S.listStates as Fn, seed.a.member, {}, seed.a.slug, teamB)).status).toBe(404);
    expect((await call(S.listStates as Fn, seed.a.member, {}, seed.a.slug, randomUUID())).status).toBe(404);
    expect((await call(S.listStates as Fn, seed.a.admin, {}, seed.a.slug, teamA2)).status).toBe(200);
  });

  it("keeps status and state_id in sync in both directions", async () => {
    const s = await states(seed.a.member, teamA);
    const r = await newIssue({ status: "in_review", estimate: 3, due_date: "2026-11-05" });
    expect(r.status).toBe(201);
    const i = await r.json();
    expect(i.state_id).toBe(s[3]!.id); expect(i.estimate).toBe(3); expect(i.due_date).toBe("2026-11-05");
    const p1 = await (await patch(i.id, i.version, { state_id: s[4]!.id })).json();
    expect(p1.status).toBe("done");
    const p2 = await (await patch(i.id, p1.version, { status: "todo" })).json();
    expect(p2.state_id).toBe(s[1]!.id);
    const p3 = await (await patch(i.id, p2.version, { status: "backlog", state_id: s[2]!.id })).json();
    expect(p3.status).toBe("in_progress"); // state_id wins
    const a = await asOwner(seed.a.id, (tx) => tx`select diff from audit_events where entity_id = ${i.id} and action = 'update' order by created_at`);
    expect(a[0]!.diff).toHaveProperty("state_id"); expect(a[0]!.diff).toHaveProperty("status");
  });

  it("validates estimates against the team scale on create and patch (scale none = unrestricted)", async () => {
    expect((await newIssue({ estimate: 7 })).status).toBe(201); // default scale none
    await asOwner(seed.a.id, (tx) => tx`update team_settings set estimate_scale = 'fibonacci', estimate_allow_zero = false where team_id = ${teamA}`);
    expect((await newIssue({ estimate: 4 })).status).toBe(422);
    expect((await newIssue({ estimate: 0 })).status).toBe(422);
    const ok = await newIssue({ estimate: 5 });
    expect(ok.status).toBe(201);
    const i = await ok.json();
    expect((await patch(i.id, i.version, { estimate: 4 })).status).toBe(422);
    expect((await patch(i.id, i.version, { estimate: 8 })).status).toBe(200);
    await asOwner(seed.a.id, (tx) => tx`update team_settings set estimate_allow_zero = true where team_id = ${teamA}`);
    expect((await newIssue({ estimate: 0 })).status).toBe(201);
    await asOwner(seed.a.id, (tx) => tx`update team_settings set estimate_scale = 'none', estimate_allow_zero = false where team_id = ${teamA}`);
  });

  it("rejects a state of another team, bad estimate and bad due date with 422", async () => {
    const other = (await states(seed.a.admin, teamA2))[0]!.id;
    expect((await newIssue({ state_id: other })).status).toBe(422);
    expect((await newIssue({ estimate: 65 })).status).toBe(422);
    expect((await newIssue({ estimate: -1 })).status).toBe(422);
    expect((await newIssue({ due_date: "2026-02-30" })).status).toBe(422);
    const i = await (await newIssue({})).json();
    expect((await patch(i.id, i.version, { state_id: other })).status).toBe(422);
    const c = await (await patch(i.id, i.version, { estimate: null, due_date: null })).json();
    expect(c.estimate).toBeNull(); expect(c.due_date).toBeNull();
  });

  it("filters by state_id, estimate and due date", async () => {
    const s = await states(seed.a.member, teamA);
    const x = await (await newIssue({ state_id: s[5]!.id, estimate: 8, due_date: "2030-01-10" })).json();
    const list = async (q: string) => ((await (await call(H.listIssues as Fn, seed.a.member, { q }, seed.a.slug)).json()).items as { id: string }[]).map((r) => r.id);
    expect(await list(`?state_id=${s[5]!.id}`)).toContain(x.id);
    expect(await list(`?estimate=8`)).toContain(x.id);
    expect(await list(`?due_after=2030-01-01&due_before=2030-01-31`)).toEqual([x.id]);
    expect(await list(`?has_due_date=false`)).not.toContain(x.id);
  });

  it("state CRUD is admin-only, versioned and audited", async () => {
    expect((await call(S.createState as Fn, seed.a.member, { method: "POST", body: j({ name: "QA", category: "started" }) }, seed.a.slug, teamA)).status).toBe(403);
    const r = await call(S.createState as Fn, seed.a.admin, { method: "POST", body: j({ name: "QA", category: "started", color: "#123456" }) }, seed.a.slug, teamA);
    expect(r.status).toBe(201);
    const st = await r.json();
    expect((await call(S.createState as Fn, seed.a.admin, { method: "POST", body: j({ name: "qa", category: "started" }) }, seed.a.slug, teamA)).status).toBe(409);
    const p = await call(S.patchState as Fn, seed.a.admin, { method: "PATCH", body: j({ name: "QA review" }), headers: { "if-match": `"${st.version}"` } }, seed.a.slug, teamA, st.id);
    expect((await p.json()).name).toBe("QA review");
    const a = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity_id = ${st.id} order by created_at`);
    expect(a.map((x) => x.action)).toEqual(["create", "update"]);
  });

  it("recategorising a state re-derives its issues' status", async () => {
    const r = await call(S.createState as Fn, seed.a.admin, { method: "POST", body: j({ name: "Parked", category: "started" }) }, seed.a.slug, teamA);
    const st = await r.json();
    const i = await (await newIssue({ state_id: st.id })).json();
    expect(i.status).toBe("in_progress");
    await call(S.patchState as Fn, seed.a.admin, { method: "PATCH", body: j({ category: "backlog" }), headers: { "if-match": `"${st.version}"` } }, seed.a.slug, teamA, st.id);
    const g = await (await call(H.getIssue as Fn, seed.a.member, {}, seed.a.slug, i.id)).json();
    expect(g.status).toBe("backlog"); expect(g.state_id).toBe(st.id);
  });

  it("refuses deleting a used state without replacement, moves issues with one, keeps one state per category", async () => {
    const s = await states(seed.a.member, teamA);
    const st = await (await call(S.createState as Fn, seed.a.admin, { method: "POST", body: j({ name: "Blocked", category: "started" }) }, seed.a.slug, teamA)).json();
    const i = await (await newIssue({ state_id: st.id })).json();
    const del = (q: string, id = st.id, v = st.version) => call(S.deleteState as Fn, seed.a.admin, { method: "DELETE", q, headers: { "if-match": `"${v}"` } }, seed.a.slug, teamA, id);
    expect((await del("")).status).toBe(409);
    expect((await del(`?replacement_id=${(await states(seed.a.admin, teamA2))[0]!.id}`)).status).toBe(422);
    expect((await del(`?replacement_id=${s[2]!.id}`)).status).toBe(204);
    const g = await (await call(H.getIssue as Fn, seed.a.member, {}, seed.a.slug, i.id)).json();
    expect(g.state_id).toBe(s[2]!.id); expect(g.status).toBe("in_progress");
    const backlog = s.filter((x) => x.category === "backlog");
    if (backlog.length === 1) expect((await del("", backlog[0]!.id, backlog[0]!.version)).status).toBe(422);
  });
});
