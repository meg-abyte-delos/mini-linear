import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as L from "../../src/lib/resources/labels-cycles";
import * as P from "../../src/lib/resources/projects-comments";
import * as I from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("labels, cycles, projects, comments API", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", teamB = "", issueA = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const send = (fn: Fn, user: string, method: string, body: unknown, ...a: string[]) => call(fn, user, { method, body: JSON.stringify(body) }, ...a);
  const mut = (fn: Fn, user: string, method: string, ver: number | null, body: unknown, ...a: string[]) =>
    call(fn, user, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: ver === null ? {} : { "if-match": `"${ver}"` } }, ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); teamB = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG'), (${teamA2}, ${seed.a.id}, 'Ops', 'OPS')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
    await asOwner(seed.b.id, (tx) => tx`insert into teams (id, workspace_id, name, key) values (${teamB}, ${seed.b.id}, 'Eng', 'ENG')`);
    issueA = (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "i" }, seed.a.slug)).json()).id;
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("labels: CRUD, unique name per workspace, If-Match, admin-only delete, audit", async () => {
    const c = await send(L.createLabel as Fn, seed.a.member, "POST", { name: "Bug", color: "#ff0000" }, seed.a.slug);
    expect(c.status).toBe(201); const l = await c.json(); expect(c.headers.get("etag")).toBe('"1"');
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "bug" }, seed.a.slug)).status).toBe(409);
    expect((await send(L.createLabel as Fn, seed.b.member, "POST", { name: "bug" }, seed.b.slug)).status).toBe(201); // other tenant: no clash
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "x", color: "red" }, seed.a.slug)).status).toBe(422);
    expect((await send(L.createLabel as Fn, seed.a.guest, "POST", { name: "g" }, seed.a.slug)).status).toBe(403);
    expect((await mut(L.patchLabel as Fn, seed.a.member, "PATCH", null, { name: "B2" }, seed.a.slug, l.id)).status).toBe(428);
    expect((await mut(L.patchLabel as Fn, seed.a.member, "PATCH", 7, { name: "B2" }, seed.a.slug, l.id)).status).toBe(412);
    const p = await mut(L.patchLabel as Fn, seed.a.member, "PATCH", 1, { name: "B2" }, seed.a.slug, l.id);
    expect(p.status).toBe(200); expect((await p.json()).version).toBe(2);
    expect((await mut(L.deleteLabel as Fn, seed.a.member, "DELETE", 2, undefined, seed.a.slug, l.id)).status).toBe(403);
    expect((await mut(L.deleteLabel as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, l.id)).status).toBe(204);
    expect((await call(L.getLabelH as Fn, seed.a.member, {}, seed.a.slug, l.id)).status).toBe(404);
    expect((await call(L.getLabelH as Fn, seed.b.owner, {}, seed.a.slug, l.id)).status).toBe(404);
    const au = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity = 'label' and entity_id = ${l.id} order by id`);
    expect(au.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    const list = await (await call(L.listLabels as Fn, seed.a.member, { q: "?limit=1" }, seed.a.slug)).json();
    expect(list).toHaveProperty("next_cursor");
  });

  it("cycles: dates validated, per-team no-overlap (inclusive), other team and tenant unaffected", async () => {
    const mk = (u: string, team: string, s: string, e: string, slug = seed.a.slug) => send(L.createCycle as Fn, u, "POST", { team_id: team, name: "c", start_date: s, end_date: e }, slug);
    const c1 = await mk(seed.a.admin, teamA, "2026-01-01", "2026-01-14");
    expect(c1.status).toBe(201); expect((await c1.json()).start_date).toBe("2026-01-01");
    expect((await mk(seed.a.admin, teamA, "2026-01-14", "2026-01-20")).status).toBe(409); // shared boundary day overlaps
    expect((await mk(seed.a.admin, teamA, "2026-01-10", "2026-01-12")).status).toBe(409);
    expect((await mk(seed.a.admin, teamA, "2026-01-15", "2026-01-28")).status).toBe(201);
    expect((await mk(seed.a.admin, teamA2, "2026-01-01", "2026-01-14")).status).toBe(201);
    expect((await mk(seed.a.admin, teamA, "2026-03-05", "2026-03-01")).status).toBe(422);
    expect((await mk(seed.a.admin, teamA, "2026-02-30", "2026-03-01")).status).toBe(422);
    expect((await mk(seed.a.admin, teamB, "2026-06-01", "2026-06-02")).status).toBe(422); // foreign team
    expect((await mk(seed.a.member, teamA, "2027-01-01", "2027-01-02")).status).toBe(403);
    const c = await (await mk(seed.a.admin, teamA, "2026-05-01", "2026-05-10")).json();
    expect((await mut(L.patchCycle as Fn, seed.a.admin, "PATCH", 1, { start_date: "2026-01-20" }, seed.a.slug, c.id)).status).toBe(409);
    const ok = await mut(L.patchCycle as Fn, seed.a.admin, "PATCH", 1, { end_date: "2026-05-12" }, seed.a.slug, c.id);
    expect(ok.status).toBe(200); expect((await ok.json()).end_date).toBe("2026-05-12");
    const l = await (await call(L.listCycles as Fn, seed.a.admin, { q: `?team_id=${teamA2}` }, seed.a.slug)).json();
    expect(l.items).toHaveLength(1);
    // deleting a cycle detaches its issues
    const iss = await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "in cycle", cycle_id: c.id }, seed.a.slug)).json();
    expect((await mut(L.deleteCycle as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, c.id)).status).toBe(204);
    expect((await (await call(I.getIssue as Fn, seed.a.member, {}, seed.a.slug, iss.id)).json()).cycle_id).toBeNull();
  });

  it("projects: team-scoped visibility, foreign team rejected, If-Match, delete detaches issues", async () => {
    const c = await send(P.createProject as Fn, seed.a.admin, "POST", { name: "P1", team_ids: [teamA] }, seed.a.slug);
    expect(c.status).toBe(201); const p = await c.json(); expect(p.team_ids).toEqual([teamA]);
    const other = await (await send(P.createProject as Fn, seed.a.admin, "POST", { name: "P2", team_ids: [teamA2] }, seed.a.slug)).json();
    const ids = async (u: string) => (await (await call(P.listProjects as Fn, u, {}, seed.a.slug)).json()).items.map((x: { id: string }) => x.id);
    expect(await ids(seed.a.member)).toEqual([p.id]); // member of teamA only
    expect((await ids(seed.a.admin)).sort()).toEqual([p.id, other.id].sort());
    expect(await ids(seed.a.guest)).toEqual([]);
    expect((await call(P.getProjectH as Fn, seed.a.member, {}, seed.a.slug, other.id)).status).toBe(404);
    expect((await send(P.createProject as Fn, seed.a.admin, "POST", { name: "bad", team_ids: [teamB] }, seed.a.slug)).status).toBe(422);
    expect((await mut(P.patchProject as Fn, seed.a.member, "PATCH", 3, { name: "z" }, seed.a.slug, p.id)).status).toBe(412);
    expect((await mut(P.patchProject as Fn, seed.a.member, "PATCH", 1, { team_ids: [teamA, teamA2] }, seed.a.slug, p.id)).status).toBe(403); // team scope is admin-only
    expect((await send(P.createProject as Fn, seed.a.member, "POST", { name: "nt" }, seed.a.slug)).status).toBe(422); // member: must include one of own teams
    expect((await send(P.createProject as Fn, seed.a.member, "POST", { name: "nt", team_ids: [teamA2] }, seed.a.slug)).status).toBe(422);
    const mine = await send(P.createProject as Fn, seed.a.member, "POST", { name: "mine", team_ids: [teamA, teamA2] }, seed.a.slug);
    expect(mine.status).toBe(201);
    const u = await mut(P.patchProject as Fn, seed.a.admin, "PATCH", 1, { name: "P1b", team_ids: [teamA, teamA2] }, seed.a.slug, p.id);
    expect(u.status).toBe(200); expect((await u.json()).team_ids.sort()).toEqual([teamA, teamA2].sort());
    const a = await asOwner(seed.a.id, (tx) => tx`select diff from audit_events where entity = 'project' and entity_id = ${p.id} and action = 'update'`);
    expect(Object.keys(a[0]!.diff as object).sort()).toEqual(["name", "team_ids"]);
    const iss = await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: teamA, title: "in proj", project_id: p.id }, seed.a.slug)).json();
    expect((await mut(P.deleteProject as Fn, seed.a.member, "DELETE", 2, undefined, seed.a.slug, p.id)).status).toBe(403);
    expect((await mut(P.deleteProject as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, p.id)).status).toBe(204);
    expect((await (await call(I.getIssue as Fn, seed.a.member, {}, seed.a.slug, iss.id)).json()).project_id).toBeNull();
  });

  it("comments: create/list/edit (author only)/delete (author or admin), guest + tenant rules", async () => {
    const mk = (u: string, body = "hello", issue = issueA, slug = seed.a.slug) => send(P.createComment as Fn, u, "POST", { body }, slug, issue);
    const c = await mk(seed.a.member); expect(c.status).toBe(201); const cm = await c.json(); expect(cm.author_id).toBe(seed.a.member);
    expect((await mk(seed.a.member, "")).status).toBe(422);
    expect((await mk(seed.a.guest)).status).toBe(403);
    expect((await mk(seed.a.member, "x", randomUUID())).status).toBe(404);
    expect((await mk(seed.b.member, "x", issueA, seed.b.slug)).status).toBe(404); // issue of another tenant
    // guest sees comments only on shared issues
    const list = (u: string) => call(P.listComments as Fn, u, {}, seed.a.slug, issueA);
    expect((await list(seed.a.guest)).status).toBe(404);
    await asOwner(seed.a.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${issueA}, ${seed.a.guest}, ${seed.a.owner})`);
    expect((await (await list(seed.a.guest)).json()).items).toHaveLength(1);
    expect((await mut(P.patchComment as Fn, seed.a.admin, "PATCH", 1, { body: "hijack" }, seed.a.slug, cm.id)).status).toBe(403);
    expect((await mut(P.patchComment as Fn, seed.a.member, "PATCH", 5, { body: "e" }, seed.a.slug, cm.id)).status).toBe(412);
    const e = await mut(P.patchComment as Fn, seed.a.member, "PATCH", 1, { body: "edited" }, seed.a.slug, cm.id);
    expect((await e.json()).body).toBe("edited");
    const other = await (await mk(seed.a.owner, "owner's")).json();
    expect((await mut(P.deleteComment as Fn, seed.a.member, "DELETE", 1, undefined, seed.a.slug, other.id)).status).toBe(403);
    expect((await mut(P.deleteComment as Fn, seed.a.admin, "DELETE", 1, undefined, seed.a.slug, other.id)).status).toBe(204);
    expect((await mut(P.deleteComment as Fn, seed.a.member, "DELETE", 2, undefined, seed.a.slug, cm.id)).status).toBe(204);
    // soft-deleted issue hides its comments
    const c2 = await (await mk(seed.a.member, "keep")).json();
    await mut(I.deleteIssue as Fn, seed.a.member, "DELETE", 1, undefined, seed.a.slug, issueA);
    expect((await call(P.getCommentH as Fn, seed.a.member, {}, seed.a.slug, c2.id)).status).toBe(404);
  });
});
