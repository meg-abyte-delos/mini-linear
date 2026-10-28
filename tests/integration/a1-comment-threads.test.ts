import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as P from "../../src/lib/resources/projects-comments";
import * as I from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("comment threads, reactions, mentions, subscribers (0103)", () => {
  const owner = ownerSql(); let seed: Seed; let team = "", issue = "", issue2 = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const send = (fn: Fn, user: string, method: string, body: unknown, ...a: string[]) => call(fn, user, { method, body: JSON.stringify(body) }, ...a);
  const mut = (fn: Fn, user: string, method: string, ver: number | null, body: unknown, ...a: string[]) =>
    call(fn, user, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: ver === null ? {} : { "if-match": `"${ver}"` } }, ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const subs = (iss: string) => asOwner(seed.a.id, (tx) => tx`select user_id, reason from issue_subscribers where issue_id = ${iss} order by user_id`);
  const mk = (u: string, body: string, parent?: string | null, iss = issue) => send(P.createComment as Fn, u, "POST", parent === undefined ? { body } : { body, parent_comment_id: parent }, seed.a.slug, iss);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    team = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${seed.a.member})`;
    });
    issue = (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: team, title: "i", assignee_id: seed.a.admin }, seed.a.slug)).json()).id;
    issue2 = (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: team, title: "j" }, seed.a.slug)).json()).id;
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("issue creator and assignee are auto-subscribed; reassignment subscribes the new assignee", async () => {
    expect((await subs(issue)).map((r) => [r.user_id, r.reason]).sort()).toEqual([[seed.a.admin, "assignee"], [seed.a.member, "creator"]].sort());
    await mut(I.patchIssue as Fn, seed.a.member, "PATCH", 1, { assignee_id: seed.a.owner }, seed.a.slug, issue2);
    expect((await subs(issue2)).map((r) => r.user_id).sort()).toEqual([seed.a.member, seed.a.owner].sort());
  });

  it("one level of threading: replies to roots only, same issue only", async () => {
    const root = await (await mk(seed.a.member, "root")).json();
    expect(root.parent_comment_id).toBeNull(); expect(root.reactions).toEqual([]); expect(root.edited_at).toBeNull();
    const r = await mk(seed.a.admin, "reply", root.id); expect(r.status).toBe(201);
    const reply = await r.json(); expect(reply.parent_comment_id).toBe(root.id);
    expect((await mk(seed.a.member, "nested", reply.id)).status).toBe(422);
    expect((await mk(seed.a.member, "x", root.id, issue2)).status).toBe(422); // parent on another issue
    expect((await mk(seed.a.member, "x", randomUUID())).status).toBe(422);
    const items = (await (await call(P.listComments as Fn, seed.a.member, {}, seed.a.slug, issue)).json()).items;
    expect(items.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([root.id, reply.id]));
    // the trigger enforces depth even for a raw insert (defence in depth)
    await expect(asOwner(seed.a.id, (tx) => tx`insert into comments (id, workspace_id, issue_id, parent_comment_id, author_id, body)
      values (${randomUUID()}, ${seed.a.id}, ${issue}, ${reply.id}, ${seed.a.member}, 'deep')`)).rejects.toThrow(/one level/);
    // deleting the root (author) cascades its replies, audited with reply_ids
    expect((await mut(P.deleteComment as Fn, seed.a.member, "DELETE", root.version, undefined, seed.a.slug, root.id)).status).toBe(204);
    expect((await call(P.getCommentH as Fn, seed.a.member, {}, seed.a.slug, reply.id)).status).toBe(404);
    const au = await asOwner(seed.a.id, (tx) => tx`select diff from audit_events where entity = 'comment' and entity_id = ${root.id} and action = 'delete'`);
    expect(au[0]!.diff.reply_ids.before).toEqual([reply.id]);
  });

  it("edit sets edited_at and bumps version (author only); delete own or admin", async () => {
    const c = await (await mk(seed.a.member, "v1")).json();
    expect((await mut(P.patchComment as Fn, seed.a.owner, "PATCH", 1, { body: "x" }, seed.a.slug, c.id)).status).toBe(403);
    expect((await mut(P.patchComment as Fn, seed.a.member, "PATCH", 1, { body: "v2", parent_comment_id: null }, seed.a.slug, c.id)).status).toBe(422); // cannot re-parent
    const e = await (await mut(P.patchComment as Fn, seed.a.member, "PATCH", 1, { body: "v2" }, seed.a.slug, c.id)).json();
    expect(e.version).toBe(2); expect(e.edited_at).not.toBeNull();
    expect((await mut(P.deleteComment as Fn, seed.a.guest, "DELETE", 2, undefined, seed.a.slug, c.id)).status).toBe(403);
    expect((await mut(P.deleteComment as Fn, seed.a.admin, "DELETE", 2, undefined, seed.a.slug, c.id)).status).toBe(204);
  });

  it("resolve/unresolve: roots only, idempotent, audited; a reply reopens", async () => {
    const root = await (await mk(seed.a.member, "t")).json();
    const res = await (await send(P.resolveComment as Fn, seed.a.admin, "POST", {}, seed.a.slug, root.id)).json();
    expect(res.resolved_at).not.toBeNull(); expect(res.resolved_by).toBe(seed.a.admin);
    expect((await (await send(P.resolveComment as Fn, seed.a.admin, "POST", {}, seed.a.slug, root.id)).json()).version).toBe(res.version);
    expect((await send(P.resolveComment as Fn, seed.a.guest, "POST", {}, seed.a.slug, root.id)).status).toBe(403);
    const reply = await (await mk(seed.a.admin, "re", root.id)).json();
    expect((await send(P.resolveComment as Fn, seed.a.admin, "POST", {}, seed.a.slug, reply.id)).status).toBe(422);
    expect((await (await call(P.getCommentH as Fn, seed.a.member, {}, seed.a.slug, root.id)).json()).resolved_at).toBeNull();
    await send(P.resolveComment as Fn, seed.a.admin, "POST", {}, seed.a.slug, root.id);
    expect((await (await send(P.unresolveComment as Fn, seed.a.member, "POST", {}, seed.a.slug, root.id)).json()).resolved_at).toBeNull();
    const au = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity = 'comment' and entity_id = ${root.id} order by id`);
    expect(au.map((r) => r.action)).toEqual(["create", "resolve", "resolve", "unresolve"]);
  });

  it("reactions: unique per user+emoji, idempotent add, own-only remove, aggregated on the comment, tenant isolated", async () => {
    const c = await (await mk(seed.a.member, "react to me")).json();
    const add = (u: string, emoji: string, slug = seed.a.slug) => send(P.addReaction as Fn, u, "POST", { emoji }, slug, c.id);
    expect((await add(seed.a.member, "👍")).status).toBe(201);
    expect((await add(seed.a.member, "👍")).status).toBe(200);
    expect((await add(seed.a.admin, "👍")).status).toBe(201);
    expect((await add(seed.a.admin, ":tada:")).status).toBe(201);
    expect((await add(seed.a.member, "lol")).status).toBe(422);
    expect((await add(seed.a.guest, "👍")).status).toBe(403);
    expect((await add(seed.b.member, "👍", seed.b.slug)).status).toBe(404);
    const got = await (await call(P.getCommentH as Fn, seed.a.member, {}, seed.a.slug, c.id)).json();
    expect(got.reactions).toEqual([{ emoji: "👍", count: 2, user_ids: [seed.a.member, seed.a.admin] }, { emoji: ":tada:", count: 1, user_ids: [seed.a.admin] }]);
    expect((await (await call(P.listReactions as Fn, seed.a.member, {}, seed.a.slug, c.id)).json()).items).toHaveLength(3);
    expect((await call(P.removeReaction as Fn, seed.a.member, { method: "DELETE", q: "?emoji=:tada:" }, seed.a.slug, c.id)).status).toBe(404); // not mine
    expect((await send(P.removeReaction as Fn, seed.a.member, "DELETE", { emoji: "👍" }, seed.a.slug, c.id)).status).toBe(204);
    const au = await asOwner(seed.a.id, (tx) => tx`select action from audit_events where entity = 'comment_reaction' order by id`);
    expect(au.map((r) => r.action)).toEqual(["create", "create", "create", "delete"]);
  });

  it("mentions: @handle and @[x](uuid) resolve to members of THIS workspace, subscribe them, re-sync on edit", async () => {
    const c = await (await mk(seed.a.member, `hey @admin and @[O](${seed.a.owner}) and @[B](${seed.b.member}) @nobody \`@guest\` @member`)).json();
    expect([...c.mention_ids].sort()).toEqual([seed.a.admin, seed.a.owner].sort()); // cross-tenant id, unknown handle, code span and self dropped
    const s = await subs(issue);
    expect(s.find((r) => r.user_id === seed.a.owner)?.reason).toBe("mention");
    // a guest is only mentionable when the issue is shared with them (mention visibility filter); unshared guests are dropped
    const dropped = await (await mut(P.patchComment as Fn, seed.a.member, "PATCH", 1, { body: "only @guest now" }, seed.a.slug, c.id)).json();
    expect(dropped.mention_ids).toEqual([]);
    await asOwner(seed.a.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${issue}, ${seed.a.guest}, ${seed.a.admin})`);
    const e = await (await mut(P.patchComment as Fn, seed.a.member, "PATCH", 2, { body: "only @guest now" }, seed.a.slug, c.id)).json();
    expect(e.mention_ids).toEqual([seed.a.guest]); // mention row kept for a guest...
    expect((await subs(issue)).some((r) => r.user_id === seed.a.guest)).toBe(false); // ...but guests are never auto-subscribed
  });

  it("new tables are tenant isolated under RLS for app_user", async () => {
    const rows = await db().begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.b.id}, true)`;
      return [await tx`select 1 from comment_reactions`, await tx`select 1 from comment_mentions`, await tx`select 1 from issue_subscribers`]; });
    for (const r of rows) expect(r).toHaveLength(0);
  });
});
