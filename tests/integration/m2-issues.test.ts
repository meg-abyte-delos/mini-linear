import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("issues API", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamB = "", labelB = "", labelA = "";
  const call = (fn: (r: Request, ...a: string[]) => Promise<Response>, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const post = (user: string, body: unknown, w = seed.a.slug) => call(H.createIssue as never, user, { method: "POST", body: JSON.stringify(body) }, w);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamB = randomUUID(); labelA = randomUUID(); labelB = randomUUID();
    for (const [ws, t, l] of [[seed.a.id, teamA, labelA], [seed.b.id, teamB, labelB]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, 'Eng', 'ENG')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${t}, ${ws === seed.a.id ? seed.a.member : seed.b.member})`;
      await tx`insert into labels (id, workspace_id, name) values (${l}, ${ws}, 'bug')`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("creates with identifier, ETag and audit; numbers increment", async () => {
    const r1 = await post(seed.a.member, { team_id: teamA, title: "one", label_ids: [labelA] });
    expect(r1.status).toBe(201);
    const i1 = await r1.json();
    expect(i1.identifier).toBe("ENG-1"); expect(i1.label_ids).toEqual([labelA]); expect(r1.headers.get("etag")).toBe('"1"');
    expect((await (await post(seed.a.member, { team_id: teamA, title: "two" })).json()).identifier).toBe("ENG-2");
    const audit = await asOwner(seed.a.id, (tx) => tx`select action, actor_id, diff from audit_events where entity_id = ${i1.id}`);
    expect(audit).toHaveLength(1); expect(audit[0]!.actor_id).toBe(seed.a.member); expect(audit[0]!.diff).toHaveProperty("title");
  });

  it("validates input and roles", async () => {
    expect((await post(seed.a.member, { team_id: teamA, title: "" })).status).toBe(422);
    expect((await post(seed.a.member, { team_id: teamA, title: "x", bogus: 1 })).status).toBe(422);
    expect((await post(seed.a.guest, { team_id: teamA, title: "x" })).status).toBe(403);
    expect((await post(seed.a.member, { team_id: randomUUID(), title: "x" })).status).toBe(422);
  });

  it("rejects cross-tenant references (team, label)", async () => {
    expect((await post(seed.a.member, { team_id: teamB, title: "x" })).status).toBe(422);
    expect((await post(seed.a.member, { team_id: teamA, title: "x", label_ids: [labelB] })).status).toBe(422);
    expect((await post(seed.b.member, { team_id: teamB, title: "x" }, seed.a.slug)).status).toBe(404);
  });

  it("PATCH needs If-Match; stale -> 412; success bumps version and audits only changed fields", async () => {
    const i = await (await post(seed.a.member, { team_id: teamA, title: "p" })).json();
    const patch = (v: string | null, body: unknown) => call(H.patchIssue as never, seed.a.member, { method: "PATCH", body: JSON.stringify(body), headers: v ? { "if-match": v } : {} }, seed.a.slug, i.id);
    expect((await patch(null, { title: "q" })).status).toBe(428);
    expect((await patch('"9"', { title: "q" })).status).toBe(412);
    const ok = await patch('"1"', { title: "q", status: "todo" });
    expect(ok.status).toBe(200);
    const j = await ok.json(); expect(j.version).toBe(2); expect(j.title).toBe("q");
    expect((await patch('"1"', { title: "again" })).status).toBe(412);
    const a = await asOwner(seed.a.id, (tx) => tx`select diff from audit_events where entity_id = ${i.id} and action = 'update'`);
    expect(Object.keys(a[0]!.diff as object).sort()).toEqual(["state_id", "status", "title"]); // a status change moves the issue to the matching workflow state (0101)
  });

  it("soft delete hides, restore brings back; 404 across tenants", async () => {
    const i = await (await post(seed.a.member, { team_id: teamA, title: "d" })).json();
    const del = await call(H.deleteIssue as never, seed.a.member, { method: "DELETE", headers: { "if-match": '"1"' } }, seed.a.slug, i.id);
    expect(del.status).toBe(204);
    expect((await call(H.getIssue as never, seed.a.member, {}, seed.a.slug, i.id)).status).toBe(404);
    const rs = await call(H.restoreIssue as never, seed.a.member, { method: "POST" }, seed.a.slug, i.id);
    expect(rs.status).toBe(200); expect((await rs.json()).deleted_at).toBeNull();
    expect((await call(H.getIssue as never, seed.b.owner, {}, seed.a.slug, i.id)).status).toBe(404);
    expect((await call(H.getIssue as never, seed.a.member, {}, seed.a.slug, "not-a-uuid")).status).toBe(404);
  });

  it("lists with keyset pagination, filters, and guest visibility via shares", async () => {
    const ids: string[] = [];
    for (let k = 0; k < 5; k++) ids.push((await (await post(seed.b.member, { team_id: teamB, title: `l${k}`, status: k % 2 ? "todo" : "backlog" }, seed.b.slug)).json()).id);
    const list = (u: string, q: string) => call(H.listIssues as never, u, { q }, seed.b.slug);
    const p1 = await (await list(seed.b.member, "?limit=2")).json();
    expect(p1.items.map((x: { id: string }) => x.id)).toEqual(ids.slice(0, 2)); expect(p1.next_cursor).toBeTruthy();
    const p2 = await (await list(seed.b.member, `?limit=2&cursor=${p1.next_cursor}`)).json();
    expect(p2.items.map((x: { id: string }) => x.id)).toEqual(ids.slice(2, 4));
    const p3 = await (await list(seed.b.member, `?limit=2&cursor=${p2.next_cursor}`)).json();
    expect(p3.items).toHaveLength(1); expect(p3.next_cursor).toBeNull();
    expect((await (await list(seed.b.member, "?status=todo")).json()).items).toHaveLength(2);
    expect((await list(seed.b.member, "?cursor=garbage")).status).toBe(400);
    expect((await list(seed.b.member, `?cursor=${p1.next_cursor}`)).status).toBe(200);
    expect((await call(H.listIssues as never, seed.a.member, { q: `?cursor=${p1.next_cursor}` }, seed.a.slug)).status).toBe(400); // cursor bound to its workspace
    expect((await (await list(seed.b.guest, "")).json()).items).toHaveLength(0);
    await asOwner(seed.b.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.b.id}, ${ids[0]!}, ${seed.b.guest}, ${seed.b.owner})`);
    expect((await (await list(seed.b.guest, "")).json()).items.map((x: { id: string }) => x.id)).toEqual([ids[0]]);
    expect((await call(H.getIssue as never, seed.b.guest, {}, seed.b.slug, ids[1]!)).status).toBe(404);
  });
});
