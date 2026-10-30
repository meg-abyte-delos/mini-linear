import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as A from "../../src/lib/issues/activity-attachments";
import * as C from "../../src/lib/resources/projects-comments";
import * as L from "../../src/lib/resources/labels-cycles";
import * as W from "../../src/lib/resources/workflow-states";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
type Fn = (r: Request, ...a: string[]) => Promise<Response>;
type Item = { action: string; entity: string; summary: string; actor_id: string; changes: { field: string; before: unknown; after: unknown }[] };

(haveDb ? describe : describe.skip)("server-side activity feed: every issue mutation is recorded", () => {
  const owner = ownerSql(); let seed: Seed; let team = "";
  const call = (fn: Fn, user: string, method: string, body: unknown, ver: number | null, ...a: string[]) =>
    fn(new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "x-u": user, "content-type": "application/json", ...(ver === null ? {} : { "if-match": `"${ver}"` }) } }), ...a);
  const asOwner = <T>(f: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return f(tx); }) as Promise<T>;
  const make = async (title: string, extra: object = {}) => (await (await call(H.createIssue as Fn, seed.a.member, "POST", { team_id: team, title, ...extra }, null, seed.a.slug)).json()) as { id: string; version: number };
  const patch = async (id: string, ver: number, body: object) => {
    const r = await call(H.patchIssue as Fn, seed.a.member, "PATCH", body, ver, seed.a.slug, id);
    expect(r.status).toBe(200); return (await r.json()) as { version: number };
  };
  const feed = async (id: string, user = seed.a.member): Promise<Item[]> => {
    const r = await call(A.listActivity as Fn, user, "GET", undefined, null, seed.a.slug, id);
    expect(r.status).toBe(200); return (await r.json()).items;
  };
  const sole = (items: Item[], field: string) => items.find((i) => i.action === "update" && i.changes.some((c) => c.field === field));

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    team = randomUUID();
    await asOwner(async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'FEED')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("records status, priority, assignee, label, project and cycle changes with actor and readable summary", async () => {
    const label = await (await call(L.createLabel as Fn, seed.a.member, "POST", { name: "feed-bug", team_id: null }, null, seed.a.slug)).json();
    const project = await (await call(C.createProject as Fn, seed.a.admin, "POST", { name: "Feed P", team_ids: [team] }, null, seed.a.slug)).json();
    const cycle = await (await call(L.createCycle as Fn, seed.a.admin, "POST", { team_id: team, name: "C1", start_date: "2030-01-01", end_date: "2030-01-14" }, null, seed.a.slug)).json();
    const i = await make("feed fields");
    let v = i.version;
    v = (await patch(i.id, v, { status: "in_progress" })).version;
    v = (await patch(i.id, v, { priority: 1 })).version;
    v = (await patch(i.id, v, { assignee_id: seed.a.admin })).version;
    v = (await patch(i.id, v, { label_ids: [label.id] })).version;
    v = (await patch(i.id, v, { project_id: project.id })).version;
    v = (await patch(i.id, v, { cycle_id: cycle.id })).version;
    await patch(i.id, v, { assignee_id: null });
    const items = await feed(i.id);
    expect(items.every((x) => x.actor_id === seed.a.member)).toBe(true);
    expect(sole(items, "status")!.changes.find((c) => c.field === "status")).toMatchObject({ after: "in_progress" });
    expect(sole(items, "priority")!.summary).toContain("priority");
    expect(sole(items, "label_ids")!.summary).toContain("added feed-bug");
    expect(sole(items, "project_id")!.changes.find((c) => c.field === "project_id")).toMatchObject({ before: null, after: project.id });
    expect(sole(items, "cycle_id")!.changes.find((c) => c.field === "cycle_id")).toMatchObject({ after: cycle.id });
    const asg = items.filter((x) => x.changes.some((c) => c.field === "assignee_id"));
    expect(asg.length).toBe(2); // set, then cleared (newest first)
    expect(asg[0]!.summary).toContain("cleared");
    expect(items[items.length - 1]!.action).toBe("create");
    // a no-op patch must not add an empty "updated the issue" event
    const n = items.length; await patch(i.id, (await (await call(H.getIssue as Fn, seed.a.member, "GET", undefined, null, seed.a.slug, i.id)).json()).version, { priority: 1 });
    expect((await feed(i.id)).filter((x) => x.action === "update" && x.changes.length === 0).length).toBe(0);
    expect((await feed(i.id)).length).toBe(n);
  });

  it("records comments (create/edit) in the same feed without leaking the body", async () => {
    const i = await make("feed comments");
    const c = await (await call(C.createComment as Fn, seed.a.member, "POST", { body: "secret words" }, null, seed.a.slug, i.id)).json();
    await call(C.patchComment as Fn, seed.a.member, "PATCH", { body: "edited secret" }, c.version, seed.a.slug, c.id);
    const items = await feed(i.id);
    expect(items.filter((x) => x.entity === "comment").map((x) => x.action).sort()).toEqual(["create", "update"]);
    expect(JSON.stringify(items)).not.toContain("secret");
  });

  it("bulk patch records one event per issue, flagged bulk, with label and cycle diffs", async () => {
    const label = await (await call(L.createLabel as Fn, seed.a.member, "POST", { name: "feed-bulk", team_id: null }, null, seed.a.slug)).json();
    const a = await make("bulk a"), b = await make("bulk b");
    const r = await call(H.bulkIssues as Fn, seed.a.member, "POST", { ids: [a.id, b.id], patch: { status: "done", label_ids_add: [label.id] } }, null, seed.a.slug);
    expect((await r.json()).succeeded.length).toBe(2);
    for (const id of [a.id, b.id]) {
      const it = sole(await feed(id), "status")!;
      expect(it.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["status", "label_ids"]));
    }
  });

  it("deleting a label, project or cycle leaves a trail on every affected issue", async () => {
    const label = await (await call(L.createLabel as Fn, seed.a.member, "POST", { name: "feed-gone", team_id: null }, null, seed.a.slug)).json();
    const project = await (await call(C.createProject as Fn, seed.a.admin, "POST", { name: "Gone P", team_ids: [team] }, null, seed.a.slug)).json();
    const cycle = await (await call(L.createCycle as Fn, seed.a.admin, "POST", { team_id: team, name: "Gone C", start_date: "2031-01-01", end_date: "2031-01-14" }, null, seed.a.slug)).json();
    const i = await make("feed cascade", { label_ids: [label.id], project_id: project.id, cycle_id: cycle.id });
    expect((await call(L.deleteLabel as Fn, seed.a.admin, "DELETE", undefined, label.version, seed.a.slug, label.id)).status).toBe(204);
    expect((await call(C.deleteProject as Fn, seed.a.admin, "DELETE", undefined, project.version, seed.a.slug, project.id)).status).toBe(204);
    expect((await call(L.deleteCycle as Fn, seed.a.admin, "DELETE", undefined, cycle.version, seed.a.slug, cycle.id)).status).toBe(204);
    const items = await feed(i.id);
    expect(sole(items, "label_ids")!.changes[0]).toMatchObject({ before: [label.id], after: [] });
    expect(sole(items, "project_id")!.changes[0]).toMatchObject({ before: project.id, after: null });
    expect(sole(items, "cycle_id")!.changes[0]).toMatchObject({ before: cycle.id, after: null });
  });

  it("re-categorising a workflow state records the status change on its issues", async () => {
    const mk = await call(W.createState as Fn, seed.a.admin, "POST", { name: "Extra started", category: "started" }, null, seed.a.slug, team);
    expect(mk.status).toBe(201); const st = await mk.json();
    const i = await make("feed recat");
    await patch(i.id, i.version, { state_id: st.id });
    expect((await call(W.patchState as Fn, seed.a.admin, "PATCH", { category: "unstarted" }, st.version, seed.a.slug, team, st.id)).status).toBe(200);
    const it = (await feed(i.id)).find((x) => x.changes.some((c) => c.field === "status" && c.before === "in_progress"));
    expect(it, "status change from the recategorisation is in the feed").toBeTruthy();
  });

  it("feed is visible to a guest only through the issue's visibility rules", async () => {
    const i = await make("feed guest");
    const r = await call(A.listActivity as Fn, seed.a.guest, "GET", undefined, null, seed.a.slug, i.id);
    expect(r.status).toBe(404);
    const foreign = await call(A.listActivity as Fn, seed.b.member, "GET", undefined, null, seed.a.slug, i.id);
    expect([403, 404]).toContain(foreign.status);
  });
});
