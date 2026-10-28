import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("issues archive / bulk / branch_name", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamB = "", labelA = "";
  const req = (user: string, method: string, body?: unknown, q = "") =>
    new Request(`http://x/api${q}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "x-u": user, "content-type": "application/json" } });
  const create = async (user: string, title: string, team = teamA, ws = seed.a.slug) => (await (await H.createIssue(req(user, "POST", { team_id: team, title }), ws)).json()) as { id: string; version: number; [k: string]: unknown };
  const list = async (user: string, q = "") => ((await (await H.listIssues(req(user, "GET", undefined, q), seed.a.slug)).json()) as { items: { id: string }[] }).items.map((i) => i.id);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamB = randomUUID(); labelA = randomUUID();
    for (const [ws, t] of [[seed.a.id, teamA], [seed.b.id, teamB]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, 'Arc', 'ARC')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${t}, ${ws === seed.a.id ? seed.a.member : seed.b.member})`;
    });
    await asOwner(seed.a.id, (tx) => tx`insert into labels (id, workspace_id, name) values (${labelA}, ${seed.a.id}, 'arc-bug')`);
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("exposes branch_name and url on the DTO", async () => {
    const i = await create(seed.a.member, "Hello World");
    expect(i.branch_name).toMatch(/^[a-z0-9-]+\/arc-\d+-hello-world$/);
    expect(i.url).toBe(`/w/${seed.a.slug}/issue/${i.identifier}`);
    expect(i.archived_at).toBeNull();
  });

  it("archive hides from list by default, include_archived shows it, unarchive restores; audited", async () => {
    const i = await create(seed.a.member, "to archive");
    const r = await H.archiveIssue(req(seed.a.member, "POST"), seed.a.slug, i.id);
    expect(r.status).toBe(200); expect((await r.json()).archived_at).not.toBeNull();
    expect(await list(seed.a.member)).not.toContain(i.id);
    expect(await list(seed.a.member, "?include_archived=true")).toContain(i.id);
    expect((await H.getIssue(req(seed.a.member, "GET"), seed.a.slug, i.id)).status).toBe(200);
    expect((await H.unarchiveIssue(req(seed.a.member, "POST"), seed.a.slug, i.id)).status).toBe(200);
    expect(await list(seed.a.member)).toContain(i.id);
    const acts = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity_id = ${i.id} order by created_at`);
    expect(acts.map((a) => a.action)).toEqual(["create", "archive", "unarchive"]);
  });

  it("archive is member-only and tenant-scoped", async () => {
    const i = await create(seed.a.member, "guarded");
    expect((await H.archiveIssue(req(seed.b.member, "POST"), seed.a.slug, i.id)).status).toBeGreaterThanOrEqual(403);
    expect((await H.archiveIssue(req(seed.b.member, "POST"), seed.b.slug, i.id)).status).toBe(404);
  });

  it("restore is single-shot", async () => {
    const i = await create(seed.a.member, "del");
    const d = await H.deleteIssue(new Request("http://x", { method: "DELETE", headers: { "x-u": seed.a.member, "if-match": `"${i.version}"` } }), seed.a.slug, i.id);
    expect(d.status).toBe(204);
    expect((await H.restoreIssue(req(seed.a.member, "POST"), seed.a.slug, i.id)).status).toBe(200);
    expect((await H.restoreIssue(req(seed.a.member, "POST"), seed.a.slug, i.id)).status).toBe(404);
  });

  it("bulk patch applies per issue, reports partial failures, audits each", async () => {
    const a = await create(seed.a.member, "b1"), b = await create(seed.a.member, "b2");
    const foreign = await create(seed.b.member, "other ws", teamB, seed.b.slug);
    const r = await H.bulkIssues(req(seed.a.member, "POST", { ids: [a.id, b.id, foreign.id, a.id], patch: { priority: 2, label_ids_add: [labelA] } }), seed.a.slug);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.succeeded.sort()).toEqual([a.id, b.id].sort());
    expect(body.failed).toEqual([{ id: foreign.id, code: "not_found", message: expect.any(String) }]);
    const got = await (await H.getIssue(req(seed.a.member, "GET"), seed.a.slug, a.id)).json();
    expect(got.priority).toBe(2); expect(got.label_ids).toEqual([labelA]);
    const n = await asOwner(seed.a.id, (tx) => tx`select count(*)::int as n from audit_events where entity_id in ${tx([a.id, b.id])} and action = 'update'`);
    expect(n[0]!.n).toBe(2);
  });

  it("bulk actions archive/delete/restore", async () => {
    const a = await create(seed.a.member, "c1");
    for (const action of ["archive", "delete", "restore"]) {
      const r = await (await H.bulkIssues(req(seed.a.member, "POST", { ids: [a.id], action }), seed.a.slug)).json();
      expect(r.succeeded).toEqual([a.id]);
    }
    expect(await list(seed.a.member, "?include_archived=true")).toContain(a.id);
  });

  it("bulk validates input: 250 cap, empty patch, guests rejected", async () => {
    const ids = Array.from({ length: H.BULK_MAX + 1 }, () => randomUUID());
    expect((await H.bulkIssues(req(seed.a.member, "POST", { ids, action: "archive" }), seed.a.slug)).status).toBe(422);
    expect((await H.bulkIssues(req(seed.a.member, "POST", { ids: [randomUUID()], patch: {} }), seed.a.slug)).status).toBe(422);
    expect((await H.bulkIssues(req(seed.a.member, "POST", { ids: [randomUUID()], patch: { title: "x" } }), seed.a.slug)).status).toBe(422);
  });
});
