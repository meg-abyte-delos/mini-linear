import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as A from "../../src/lib/issues/activity-attachments";
import * as C from "../../src/lib/resources/projects-comments";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("issue activity + attachments", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", issue = "";
  const call = (fn: (r: Request, ...a: string[]) => Promise<Response>, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const attach = (user: string, body: unknown, id = issue, ws = seed.a.slug) => call(A.createAttachment as never, user, { method: "POST", body: JSON.stringify(body) }, ws, id);
  const activity = (user: string, q = "", id = issue, ws = seed.a.slug) => call(A.listActivity as never, user, { q }, ws, id);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ACT')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
    const r = await call(H.createIssue as never, seed.a.member, { method: "POST", body: JSON.stringify({ team_id: teamA, title: "one" }) }, seed.a.slug);
    issue = (await r.json()).id;
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("creates link/file attachments with validation and auto-title", async () => {
    const r = await attach(seed.a.member, { url: "https://github.com/acme/app/pull/7" });
    expect(r.status).toBe(201);
    const a = await r.json();
    expect(a).toMatchObject({ kind: "link", title: "github.com/acme/app/pull/7", created_by: seed.a.member, issue_id: issue });
    const f = await (await attach(seed.a.member, { kind: "file", url: "https://cdn.x.io/Spec%20v2.pdf", mime_type: "application/pdf", size_bytes: 1234 })).json();
    expect(f).toMatchObject({ kind: "file", title: "Spec v2.pdf", size_bytes: 1234 });
    for (const bad of [{ url: "javascript:alert(1)" }, { url: "ftp://x/y" }, { url: "https://x.io", bogus: 1 }, { kind: "link", url: "https://x.io", size_bytes: 1 }])
      expect((await attach(seed.a.member, bad)).status).toBe(422);
    expect((await attach(seed.a.guest, { url: "https://x.io" })).status).toBe(403);
    expect((await attach(seed.b.member, { url: "https://x.io" })).status).toBe(404); // other tenant
    expect((await attach(seed.a.member, { url: "https://x.io" }, randomUUID())).status).toBe(404);
    const list = await (await call(A.listAttachments as never, seed.a.member, {}, seed.a.slug, issue)).json();
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([a.id, f.id]);
  });

  it("only the creator or an admin deletes; RLS blocks cross-tenant reads", async () => {
    const a = await (await attach(seed.a.member, { url: "https://x.io/del" })).json();
    const del = (u: string) => call(A.deleteAttachment as never, u, { method: "DELETE" }, seed.a.slug, issue, a.id);
    expect((await del(seed.a.guest)).status).toBe(403);
    expect((await del(seed.a.admin)).status).toBe(204);
    expect((await del(seed.a.admin)).status).toBe(404);
    const leak = await asOwner(seed.b.id, (tx) => tx`select 1 from issue_attachments where issue_id = ${issue}`);
    expect(leak).toHaveLength(0);
  });

  it("merges issue, comment and attachment events newest first with readable diffs and cursor paging", async () => {
    const g = await call(H.getIssue as never, seed.a.member, {}, seed.a.slug, issue);
    const p = await call(H.patchIssue as never, seed.a.member, { method: "PATCH", headers: { "if-match": g.headers.get("etag")! }, body: JSON.stringify({ status: "in_progress", priority: 2 }) }, seed.a.slug, issue);
    expect(p.status).toBe(200);
    const cm = await (await call(C.createComment as never, seed.a.member, { method: "POST", body: JSON.stringify({ body: "hello" }) }, seed.a.slug, issue)).json();
    expect((await call(C.deleteComment as never, seed.a.member, { method: "DELETE", headers: { "if-match": '"1"' } }, seed.a.slug, cm.id)).status).toBe(204);
    const body = await (await activity(seed.a.member)).json();
    const sums = body.items.map((x: { summary: string }) => x.summary);
    expect(sums[0]).toBe("deleted a comment"); expect(sums[1]).toBe("commented");
    expect(sums).toContain("changed status from Backlog to In Progress, changed priority from No priority to High");
    expect(sums).toContain("attached Spec v2.pdf"); expect(sums).toContain("removed attachment x.io/del");
    expect(sums[sums.length - 1]).toBe("created the issue");
    const upd = body.items.find((x: { action: string; entity: string }) => x.entity === "issue" && x.action === "update");
    expect(upd.actor_id).toBe(seed.a.member);
    expect(upd.changes.find((c: { field: string }) => c.field === "priority")).toMatchObject({ before: 0, after: 2, text: "changed priority from No priority to High" });
    // paging walks the same feed with no dupes
    const seen: string[] = []; let cur: string | null = null;
    do {
      const pg: { items: { id: string }[]; next_cursor: string | null } = await (await activity(seed.a.member, `?limit=2${cur ? `&cursor=${encodeURIComponent(cur)}` : ""}`)).json();
      seen.push(...pg.items.map((x) => x.id)); cur = pg.next_cursor;
    } while (cur);
    expect(seen).toEqual(body.items.map((x: { id: string }) => x.id));
    const onlyAtt = await (await activity(seed.a.member, "?entity=attachment")).json();
    expect(onlyAtt.items.every((x: { entity: string }) => x.entity === "attachment")).toBe(true);
    expect((await activity(seed.a.member, "?cursor=forged")).status).toBe(400);
    expect((await activity(seed.b.member)).status).toBe(404);
    expect((await activity(seed.a.guest)).status).toBe(404); // not shared with the guest
  });

  it("does not leak events of another issue", async () => {
    const other = (await (await call(H.createIssue as never, seed.a.member, { method: "POST", body: JSON.stringify({ team_id: teamA, title: "two" }) }, seed.a.slug)).json()).id;
    await attach(seed.a.member, { url: "https://x.io/other" }, other);
    const body = await (await activity(seed.a.member, "", other)).json();
    expect(body.items.map((x: { summary: string }) => x.summary)).toEqual(["attached x.io/other", "created the issue"]);
  });
});
