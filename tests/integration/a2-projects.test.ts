import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as P from "../../src/lib/resources/projects-comments";
import * as X from "../../src/lib/resources/projects-ext";
import * as I from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("Area 2: projects, milestones, updates", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit = {}, ...a: string[]) =>
    fn(new Request("http://x/api", { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const send = (fn: Fn, user: string, method: string, body: unknown, ...a: string[]) => call(fn, user, { method, body: JSON.stringify(body) }, ...a);
  const mut = (fn: Fn, user: string, method: string, ver: number, body: unknown, ...a: string[]) =>
    call(fn, user, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "if-match": `"${ver}"` } }, ...a);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("project fields, lead/member validation, dates, patch semantics", async () => {
    const c = await send(P.createProject as Fn, seed.a.admin, "POST", { name: "Alpha", team_ids: [teamA], icon: "rocket", color: "#28aba5", lead_id: seed.a.member, status: "planned", start_date: "2026-11-01", target_date: "2026-12-01", member_ids: [seed.a.member] }, seed.a.slug);
    expect(c.status).toBe(201); const p = await c.json();
    expect(p).toMatchObject({ icon: "rocket", status: "planned", lead_id: seed.a.member, start_date: "2026-11-01", target_date: "2026-12-01", member_ids: [seed.a.member], progress_pct: 0, health: null });
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "x", start_date: "2026-12-02", target_date: "2026-12-01" }, seed.a.slug)).status).toBe(422);
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "x", lead_id: seed.a.guest }, seed.a.slug)).status).toBe(422); // guests cannot lead
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "x", lead_id: seed.b.admin }, seed.a.slug)).status).toBe(422); // foreign tenant user
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "x", status: "bogus" }, seed.a.slug)).status).toBe(422);
    const u = await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 1, { lead_id: null, target_date: null, status: "in_progress" }, seed.a.slug, p.id);
    expect(u.status).toBe(200);
    expect(await u.json()).toMatchObject({ lead_id: null, target_date: null, start_date: "2026-11-01", icon: "rocket", status: "in_progress", version: 2 });
  });

  it("P-5 member_ids is lead/admin only; guests never members", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "P5", team_ids: [teamA], lead_id: seed.a.member }, seed.a.slug)).json();
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "x", member_ids: [seed.a.guest] }, seed.a.slug)).status).toBe(422);
    expect((await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 1, { member_ids: [seed.a.guest] }, seed.a.slug, p.id)).status).toBe(422);
    const ok = await mut(P.patchProject as Fn, seed.a.member, "PATCH", 1, { member_ids: [seed.a.member] }, seed.a.slug, p.id); // the lead may
    expect(ok.status).toBe(200); expect((await ok.json()).member_ids).toEqual([seed.a.member]);
    expect((await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 2, { lead_id: null }, seed.a.slug, p.id)).status).toBe(200); // admin removes the lead
    expect((await mut(P.patchProject as Fn, seed.a.member, "PATCH", 3, { member_ids: [] }, seed.a.slug, p.id)).status).toBe(403); // ex-lead no longer may
    expect((await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 3, { member_ids: [] }, seed.a.slug, p.id)).status).toBe(200);
  });
  it("progress_pct counts done / non-canceled issues; issue assignment to a project", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "Prog", team_ids: [teamA] }, seed.a.slug)).json();
    const mk = async (status: string) => (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: status, project_id: p.id, status }, seed.a.slug)).json()).id;
    await mk("done"); await mk("todo"); await mk("canceled"); await mk("done");
    const g = await (await call(P.getProjectH as Fn, seed.a.member, {}, seed.a.slug, p.id)).json();
    expect(g).toMatchObject({ issue_count: 3, done_count: 2, progress_pct: 67 });
  });

  it("milestones: CRUD, If-Match, visibility follows project, cascade, audit", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "MS", team_ids: [teamA] }, seed.a.slug)).json();
    const hidden = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "Hidden" }, seed.a.slug)).json();
    const c = await send(X.createMilestone as Fn, seed.a.member, "POST", { name: "Beta", target_date: "2026-11-15" }, seed.a.slug, p.id);
    expect(c.status).toBe(201); const m = await c.json();
    expect((await send(X.createMilestone as Fn, seed.a.member, "POST", { name: "n" }, seed.a.slug, hidden.id)).status).toBe(404);
    expect((await send(X.createMilestone as Fn, seed.a.guest, "POST", { name: "n" }, seed.a.slug, p.id)).status).toBe(403);
    expect((await mut(X.patchMilestone as Fn, seed.a.member, "PATCH", 9, { name: "z" }, seed.a.slug, m.id)).status).toBe(412);
    const u = await mut(X.patchMilestone as Fn, seed.a.member, "PATCH", 1, { name: "Beta2", target_date: null }, seed.a.slug, m.id);
    expect(await u.json()).toMatchObject({ name: "Beta2", target_date: null, version: 2 });
    const l = await (await call(X.listMilestones as Fn, seed.a.member, {}, seed.a.slug, p.id)).json();
    expect(l.items.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect((await call(X.getMilestoneH as Fn, seed.b.member, {}, seed.b.slug, m.id)).status).toBe(404); // cross-tenant
    expect((await mut(X.deleteMilestone as Fn, seed.a.member, "DELETE", 2, undefined, seed.a.slug, m.id)).status).toBe(204);
  });

  it("updates: health feeds project.health, author-only edit, admin delete", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "UP", team_ids: [teamA] }, seed.a.slug)).json();
    expect((await send(X.createUpdate as Fn, seed.a.member, "POST", { health: "nope" }, seed.a.slug, p.id)).status).toBe(422);
    const a = await (await send(X.createUpdate as Fn, seed.a.member, "POST", { health: "on_track", body: "fine" }, seed.a.slug, p.id)).json();
    const b = await (await send(X.createUpdate as Fn, seed.a.member, "POST", { health: "at_risk" }, seed.a.slug, p.id)).json();
    expect((await (await call(P.getProjectH as Fn, seed.a.member, {}, seed.a.slug, p.id)).json()).health).toBe("at_risk");
    expect((await mut(X.patchUpdate as Fn, seed.a.admin, "PATCH", 1, { health: "off_track" }, seed.a.slug, b.id)).status).toBe(403);
    expect((await mut(X.patchUpdate as Fn, seed.a.member, "PATCH", 1, { health: "off_track" }, seed.a.slug, b.id)).status).toBe(200);
    expect((await mut(X.deleteUpdate as Fn, seed.a.admin, "DELETE", 1, undefined, seed.a.slug, a.id)).status).toBe(204);
    expect((await call(X.listUpdates as Fn, seed.a.member, {}, seed.a.slug, p.id)).status).toBe(200);
  });
  // From Tess's acceptance plan (P-1..P-6, RLS). Decisions on her [H] points: statuses are backlog|planned|in_progress|paused|completed|canceled;
  // names are NOT unique; delete is a hard delete that detaches issues (project_id -> null); If-Match is mandatory.
  it("P-1 duplicate team_ids collapse, hostile/unicode names round-trip, invalid input 422", async () => {
    const names = ["<script>alert(1)</script>", "'; drop table projects;--", "🚀 مرحبا", "é".repeat(255)];
    for (const name of names) {
      const r = await send(P.createProject as Fn, seed.a.admin, "POST", { name, team_ids: [teamA, teamA] }, seed.a.slug);
      expect(r.status).toBe(201); const b = await r.json(); expect(b.name).toBe(name); expect(b.team_ids).toEqual([teamA]);
      expect(r.headers.get("content-type")).toContain("application/json");
    }
    for (const bad of [{ name: "" }, { name: "x".repeat(256) }, { name: "ok-bad", lead_id: "not-a-uuid" }, { name: "ok-bad", team_ids: [randomUUID()] }])
      expect((await send(P.createProject as Fn, seed.a.admin, "POST", bad, seed.a.slug)).status, JSON.stringify(bad).slice(0, 40)).toBe(422);
    expect((await send(P.createProject as Fn, seed.a.guest, "POST", { name: "g" }, seed.a.slug)).status).toBe(403);
    expect((await send(P.createProject as Fn, seed.b.admin, "POST", { name: "<script>alert(1)</script>" }, seed.b.slug)).status).toBe(201); // same name, other tenant
    const rows = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return tx`select count(*)::int as n from projects where name = 'ok-bad'`; });
    expect(rows[0]!.n).toBe(0); // rejected creates left nothing behind
  });

  it("P-3 If-Match is mandatory (428), stale is 412, concurrent PATCH has one winner", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "cc", team_ids: [teamA] }, seed.a.slug)).json();
    expect((await send(P.patchProject as Fn, seed.a.admin, "PATCH", { name: "x" }, seed.a.slug, p.id)).status).toBe(428);
    const rs = await Promise.all([1, 2].map((n) => mut(P.patchProject as Fn, seed.a.admin, "PATCH", 1, { description: `d${n}` }, seed.a.slug, p.id)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 412]);
    expect((await mut(P.patchProject as Fn, seed.a.guest, "PATCH", 2, { name: "g" }, seed.a.slug, p.id)).status).toBe(403);
  });

  it("P-2 pagination: 120 projects, pages of 50, no gap or duplicate", async () => {
    for (let i = 0; i < 120; i++) await send(P.createProject as Fn, seed.b.admin, "POST", { name: `pg-${i}` }, seed.b.slug);
    const list = (q: string) => P.listProjects(new Request(`http://x/api${q}`, { headers: { "x-u": seed.b.admin } }), seed.b.slug);
    const seen: string[] = []; let cursor: string | null = null;
    do {
      const j: { items: { id: string; name: string }[]; next_cursor: string | null } = await (await list(`?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).json();
      seen.push(...j.items.filter((x) => x.name.startsWith("pg-")).map((x) => x.id)); cursor = j.next_cursor;
    } while (cursor);
    expect(seen.length).toBe(120); expect(new Set(seen).size).toBe(120); expect([...seen].sort()).toEqual(seen);
    expect((await list("?limit=0")).status).toBe(422);
    expect((await list("?cursor=garbage")).status).toBeGreaterThanOrEqual(400);
  });

  it("P-4/P-6 team scope controls visibility; delete detaches issues; cross-tenant is 404; RLS counts", async () => {
    const p = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "scope", team_ids: [teamA] }, seed.a.slug)).json();
    const iss = await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "x", project_id: p.id }, seed.a.slug)).json();
    expect((await call(P.getProjectH as Fn, seed.a.member, {}, seed.a.slug, p.id)).status).toBe(200);
    expect((await call(P.getProjectH as Fn, seed.b.admin, {}, seed.b.slug, p.id)).status).toBe(404);
    expect((await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 1, { team_ids: [] }, seed.a.slug, p.id)).status).toBe(200);
    expect((await call(P.getProjectH as Fn, seed.a.member, {}, seed.a.slug, p.id)).status).toBe(404); // lost the team => lost access
    expect((await call(P.getProjectH as Fn, seed.a.guest, {}, seed.a.slug, p.id)).status).toBe(404);
    expect((await mut(P.deleteProject as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, p.id)).status).toBe(204);
    expect((await call(P.getProjectH as Fn, seed.a.admin, {}, seed.a.slug, p.id)).status).toBe(404);
    expect((await mut(P.deleteProject as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, p.id)).status).toBe(404);
    expect((await (await call(I.getIssue as Fn, seed.a.admin, {}, seed.a.slug, iss.id)).json()).project_id).toBeNull();
    const cnt = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.b.id}, true)`;
      return tx`select (select count(*)::int from projects where workspace_id = ${seed.a.id}) as p, (select count(*)::int from project_teams where workspace_id = ${seed.a.id}) as t,
        (select count(*)::int from project_milestones where workspace_id = ${seed.a.id}) as m`; });
    expect(cnt[0]).toEqual({ p: 0, t: 0, m: 0 });
  });
});
