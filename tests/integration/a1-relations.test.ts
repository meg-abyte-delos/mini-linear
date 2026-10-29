import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as R from "../../src/lib/issues/relations";
import * as A from "../../src/lib/issues/activity-attachments";
import * as S from "../../src/lib/resources/shares-audit";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("issue relations + sub-issues API", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamB = "", teamA2 = "";
  const call = (fn: (r: Request, ...a: string[]) => Promise<Response>, user: string, init: RequestInit = {}, ...a: string[]) =>
    fn(new Request("http://x/api", { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const mk = async (user: string, body: Record<string, unknown>, w = seed.a.slug) => (await call(H.createIssue as never, user, { method: "POST", body: JSON.stringify(body) }, w)).json();
  const rel = (user: string, id: string, body: unknown, w = seed.a.slug) => call(R.createRelation as never, user, { method: "POST", body: JSON.stringify(body) }, w, id);
  const list = async (user: string, id: string) => (await (await call(R.listRelations as never, user, {}, seed.a.slug, id)).json()).items;
  const get = async (id: string) => (await call(H.getIssue as never, seed.a.member, {}, seed.a.slug, id)).json();
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamB = randomUUID(); teamA2 = randomUUID();
    for (const [ws, t, key, m] of [[seed.a.id, teamA, "ENG", seed.a.member], [seed.b.id, teamB, "ENG", seed.b.member], [seed.a.id, teamA2, "OPS", null]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, ${key}, ${key})`;
      if (m) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${t}, ${m})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("blocks / blocked_by are one stored row seen from both sides, audited", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "a" }), b = await mk(seed.a.member, { team_id: teamA, title: "b" });
    const r = await rel(seed.a.member, b.id, { type: "blocked_by", related_issue_id: a.id });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ type: "blocked_by", issue_id: b.id, related_issue_id: a.id });
    expect(await list(seed.a.member, a.id)).toMatchObject([{ type: "blocks", related_issue_id: b.id }]);
    const rows = await asOwner(seed.a.id, (tx) => tx`select type, issue_id from issue_relations where issue_id in (${a.id}, ${b.id})`);
    expect(rows).toEqual([{ type: "blocks", issue_id: a.id }]);
    const au = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity_id = ${b.id} and action = 'relation_add'`);
    expect(au).toHaveLength(1);
  });

  it("rejects self, duplicate pair (either direction / type), foreign and invisible issues; guests cannot write", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "a" }), b = await mk(seed.a.member, { team_id: teamA, title: "b" });
    expect((await rel(seed.a.member, a.id, { type: "related", related_issue_id: a.id })).status).toBe(422);
    expect((await rel(seed.a.member, a.id, { type: "related", related_issue_id: b.id })).status).toBe(201);
    expect((await rel(seed.a.member, b.id, { type: "related", related_issue_id: a.id })).status).toBe(409);
    expect((await rel(seed.a.member, b.id, { type: "blocks", related_issue_id: a.id })).status).toBe(409);
    const foreign = await mk(seed.b.member, { team_id: teamB, title: "f" }, seed.b.slug);
    expect((await rel(seed.a.member, a.id, { type: "blocks", related_issue_id: foreign.id })).status).toBe(422);
    const hidden = await mk(seed.a.owner, { team_id: teamA2, title: "h" });
    expect((await rel(seed.a.member, a.id, { type: "blocks", related_issue_id: hidden.id })).status).toBe(422);
    expect((await rel(seed.a.guest, a.id, { type: "blocks", related_issue_id: b.id })).status).toBe(403);
    expect((await rel(seed.a.member, a.id, { type: "nope", related_issue_id: b.id })).status).toBe(422);
  });

  it("activity hides relation events whose other end the viewer cannot see (guest shared on one end only)", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "shared-end" }), hidden = await mk(seed.a.owner, { team_id: teamA2, title: "secret-end" });
    const ok = await mk(seed.a.member, { team_id: teamA, title: "visible-end" });
    expect((await rel(seed.a.owner, a.id, { type: "related", related_issue_id: hidden.id })).status).toBe(201);
    expect((await rel(seed.a.owner, a.id, { type: "related", related_issue_id: ok.id })).status).toBe(201);
    const sh = (id: string) => call(S.shareIssue as never, seed.a.member, { method: "POST", body: JSON.stringify({ guest_user_id: seed.a.guest }) }, seed.a.slug, id);
    expect((await sh(a.id)).status).toBe(201);
    expect((await sh(ok.id)).status).toBe(201);
    const feed = async (user: string) => JSON.stringify(await (await call(A.listActivity as never, user, {}, seed.a.slug, a.id)).json());
    const g = await feed(seed.a.guest);
    expect(g).not.toContain(hidden.id); // nothing of the unshared issue reaches the guest
    expect(g).toContain(ok.id);
    expect(await feed(seed.a.owner)).toContain(hidden.id); // admins still see it
  });

  it("DB enforces no self-relation and same workspace even for the owner role", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "a" });
    const foreign = await mk(seed.b.member, { team_id: teamB, title: "f" }, seed.b.slug);
    await expect(asOwner(seed.a.id, (tx) => tx`insert into issue_relations (id, workspace_id, type, issue_id, related_issue_id, created_by) values (${randomUUID()}, ${seed.a.id}, 'blocks', ${a.id}, ${a.id}, ${seed.a.member})`)).rejects.toThrow();
    await expect(asOwner(seed.a.id, (tx) => tx`insert into issue_relations (id, workspace_id, type, issue_id, related_issue_id, created_by) values (${randomUUID()}, ${seed.a.id}, 'blocks', ${a.id}, ${foreign.id}, ${seed.a.member})`)).rejects.toThrow();
  });

  it("duplicate moves the issue to canceled and audits the status change", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "orig" }), d = await mk(seed.a.member, { team_id: teamA, title: "dup", status: "todo" });
    expect((await rel(seed.a.member, d.id, { type: "duplicate", related_issue_id: a.id })).status).toBe(201);
    const after = await get(d.id); expect(after.status).toBe("canceled"); expect(after.version).toBe(2);
    expect((await get(a.id)).status).toBe("backlog");
    expect(await list(seed.a.member, a.id)).toMatchObject([{ type: "duplicate", direction: "incoming", related_issue_id: d.id }]);
  });

  it("DELETE removes from either side, 404 for unknown or other issue's relation", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "a" }), b = await mk(seed.a.member, { team_id: teamA, title: "b" }), c = await mk(seed.a.member, { team_id: teamA, title: "c" });
    const r = await (await rel(seed.a.member, a.id, { type: "blocks", related_issue_id: b.id })).json();
    const del = (id: string, rid: string) => call(R.deleteRelation as never, seed.a.member, { method: "DELETE" }, seed.a.slug, id, rid);
    expect((await del(c.id, r.id)).status).toBe(404);
    expect((await del(b.id, randomUUID())).status).toBe(404);
    expect((await del(b.id, r.id)).status).toBe(204);
    expect(await list(seed.a.member, a.id)).toEqual([]);
  });

  it("children lists direct sub-issues and the DTO carries sub_issues {total, done}", async () => {
    const p = await mk(seed.a.member, { team_id: teamA, title: "parent" });
    const c1 = await mk(seed.a.member, { team_id: teamA, title: "c1", parent_id: p.id, status: "done" });
    await mk(seed.a.member, { team_id: teamA, title: "c2", parent_id: p.id });
    await mk(seed.a.member, { team_id: teamA, title: "grandchild", parent_id: c1.id });
    const ch = await (await call(R.listChildren as never, seed.a.member, {}, seed.a.slug, p.id)).json();
    expect(ch.items.map((i: { title: string }) => i.title).sort()).toEqual(["c1", "c2"]);
    expect((await get(p.id)).sub_issues).toEqual({ total: 2, done: 1 });
    expect(p.sub_issues).toEqual({ total: 0, done: 0 });
    expect((await call(R.listChildren as never, seed.b.member, {}, seed.a.slug, p.id)).status).toBe(404);
  });
});
