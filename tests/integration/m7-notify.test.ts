import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";
import { db, setSessionResolver } from "../../src/lib/http/ctx";
import { createIssue, patchIssue } from "../../src/lib/issues/handlers";
import { createComment, patchComment } from "../../src/lib/resources/projects-comments";
import { getSubscription, putSubscription, deleteSubscription } from "../../src/lib/resources/subscriptions";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");

(haveDb ? describe : describe.skip)("Area 7 notification generation + subscriptions API", () => {
  const owner = ownerSql(), app = appSql(); let seed: Seed; const team = randomUUID(); let current = "";
  const json = (body?: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const as = (u: string) => { current = u; };
  const inbox = (u: string) => withWorkspace(app, seed.a.id, (tx) => tx`select type, issue_id, comment_id, actor_id from notifications order by id`, u);
  const mkIssue = async (assignee: string | null) => {
    const r = await createIssue(new Request("http://x/api", json({ team_id: team, title: "t", assignee_id: assignee })), seed.a.slug);
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; version: number };
  };
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
    });
    setSessionResolver(async () => current);
  });
  afterAll(async () => { await db().end(); await owner.end(); await app.end(); });

  it("assignment notifies the assignee, never the actor, and auto-subscribes both", async () => {
    as(seed.a.admin);
    const i = await mkIssue(seed.a.member);
    expect((await inbox(seed.a.member)).map((n) => [n.type, n.issue_id, n.actor_id])).toEqual([["assigned", i.id, seed.a.admin]]);
    expect((await inbox(seed.a.admin)).length).toBe(0);
    as(seed.a.member);
    expect(await (await getSubscription(new Request("http://x"), seed.a.slug, i.id)).json()).toEqual({ subscribed: true, source: "auto" });
  });
  it("status change notifies subscribers except the actor; reassign notifies only the new assignee", async () => {
    as(seed.a.admin);
    const i = await mkIssue(seed.a.member);
    const before = (await inbox(seed.a.member)).length;
    const r = await patchIssue(new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json", "if-match": `"${i.version}"` }, body: JSON.stringify({ status: "in_progress" }) }), seed.a.slug, i.id);
    expect(r.status).toBe(200);
    const after = await inbox(seed.a.member);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.type).toBe("status_change");
    expect((await inbox(seed.a.admin)).length).toBe(0);
  });
  it("comment: mention gets mention only, other subscribers get comment; edit notifies only newly mentioned; stranger ids are ignored", async () => {
    as(seed.a.admin);
    const i = await mkIssue(seed.a.member);
    as(seed.a.member);
    const stranger = randomUUID();
    const c = await createComment(new Request("http://x", json({ body: `ping @[Ad](${seed.a.admin}) @[x](${stranger})` })), seed.a.slug, i.id);
    expect(c.status).toBe(201);
    const cj = (await c.json()) as { id: string; version: number };
    const adminN = (await inbox(seed.a.admin)).filter((n) => n.issue_id === i.id);
    expect(adminN.map((n) => n.type)).toEqual(["mention"]);
    expect(adminN[0]!.comment_id).toBe(cj.id);
    // edit: same mention again is not re-notified
    const e = await patchComment(new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json", "if-match": `"${cj.version}"` }, body: JSON.stringify({ body: `edited @[Ad](${seed.a.admin})` }) }), seed.a.slug, cj.id);
    expect(e.status).toBe(200);
    expect((await inbox(seed.a.admin)).filter((n) => n.issue_id === i.id).length).toBe(1);
    // admin is now subscribed: a plain member comment notifies them with type comment
    const c2 = await createComment(new Request("http://x", json({ body: "plain" })), seed.a.slug, i.id);
    expect(c2.status).toBe(201);
    expect((await inbox(seed.a.admin)).filter((n) => n.issue_id === i.id).map((n) => n.type)).toEqual(["mention", "comment"]);
  });
  it("in_app preference off suppresses the notification", async () => {
    await withWorkspace(app, seed.a.id, (tx) => tx`insert into notification_preferences (workspace_id, user_id, type, in_app) values (${seed.a.id}, ${seed.a.member}, 'assigned', false)`, seed.a.member);
    as(seed.a.admin);
    const i = await mkIssue(seed.a.member);
    expect((await inbox(seed.a.member)).filter((n) => n.issue_id === i.id).length).toBe(0);
  });
  it("subscription API: PUT makes it manual, DELETE unsubscribes (204), invisible issue is 404", async () => {
    as(seed.a.admin);
    const i = await mkIssue(null);
    as(seed.a.member);
    const put = await putSubscription(new Request("http://x", json({})), seed.a.slug, i.id);
    expect(await put.json()).toEqual({ subscribed: true, source: "manual" });
    expect((await deleteSubscription(new Request("http://x", { method: "DELETE" }), seed.a.slug, i.id)).status).toBe(204);
    expect(await (await getSubscription(new Request("http://x"), seed.a.slug, i.id)).json()).toEqual({ subscribed: false, source: null });
    expect((await getSubscription(new Request("http://x"), seed.a.slug, randomUUID())).status).toBe(404);
    as(seed.a.guest);
    expect((await putSubscription(new Request("http://x", json({})), seed.a.slug, i.id)).status).toBe(404);
  });
  it("mentions are filtered by visibility: a member outside the issue's team is neither stored, subscribed nor notified", async () => {
    const outsider = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into users (id, email, password_hash, email_verified_at) values (${outsider}, ${`out-${outsider.slice(0, 6)}@x.test`}, 'x', now())`;
      await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${seed.a.id}, ${outsider}, 'member')`;
    });
    as(seed.a.admin);
    const i = await mkIssue(null);
    const c = await createComment(new Request("http://x", json({ body: `hi @[Out](${outsider}) and @[Mem](${seed.a.member})` })), seed.a.slug, i.id);
    expect(c.status).toBe(201);
    const cj = (await c.json()) as { mention_ids: string[] };
    expect(cj.mention_ids).toEqual([seed.a.member]);
    expect((await inbox(outsider)).length).toBe(0);
    const subs = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return tx`select user_id from issue_subscribers where issue_id = ${i.id}`; });
    expect(subs.map((r) => r.user_id)).not.toContain(outsider);
  });
  it("unsubscribe is a tombstone: later auto-subscribes (comment, mention) do not re-add the user or notify them as follower", async () => {
    as(seed.a.admin);
    const i = await mkIssue(seed.a.member);
    as(seed.a.member);
    expect((await deleteSubscription(new Request("http://x", { method: "DELETE" }), seed.a.slug, i.id)).status).toBe(204);
    const n0 = (await inbox(seed.a.member)).filter((n) => n.issue_id === i.id).length;
    as(seed.a.admin);
    expect((await createComment(new Request("http://x", json({ body: "plain" })), seed.a.slug, i.id)).status).toBe(201);
    expect((await createComment(new Request("http://x", json({ body: `ping @[Mem](${seed.a.member})` })), seed.a.slug, i.id)).status).toBe(201);
    as(seed.a.member);
    expect(await (await getSubscription(new Request("http://x"), seed.a.slug, i.id)).json()).toEqual({ subscribed: false, source: null });
    const after = (await inbox(seed.a.member)).filter((n) => n.issue_id === i.id);
    expect(after.length).toBe(n0 + 1); // only the explicit mention, no follower comment
    expect(after.at(-1)!.type).toBe("mention");
    expect(await (await putSubscription(new Request("http://x", json({})), seed.a.slug, i.id)).json()).toEqual({ subscribed: true, source: "manual" });
  });
});
