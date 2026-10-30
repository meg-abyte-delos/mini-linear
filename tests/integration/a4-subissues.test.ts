import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as R from "../../src/lib/issues/relations";
import * as T from "../../src/lib/resources/team-settings";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
(haveDb ? describe : describe.skip)("A4 sub-issues, relations, estimates", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", teamB = "";
  const call = (fn: (r: Request, ...a: string[]) => Promise<Response>, user: string, init: RequestInit = {}, ...a: string[]) =>
    fn(new Request("http://x/api" + ((init as { q?: string }).q ?? ""), { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const post = (user: string, body: unknown, w = seed.a.slug) => call(H.createIssue as never, user, { method: "POST", body: JSON.stringify(body) }, w);
  const mk = async (user: string, body: J, w = seed.a.slug): Promise<J> => (await post(user, body, w)).json();
  const get = async (id: string, user = seed.a.member): Promise<J> => (await call(H.getIssue as never, user, {}, seed.a.slug, id)).json();
  const patch = (id: string, v: number, body: unknown, user = seed.a.member) => call(H.patchIssue as never, user, { method: "PATCH", body: JSON.stringify(body), headers: { "if-match": `"${v}"` } }, seed.a.slug, id);
  const subs = (user: string, id: string, q = "") => call(R.listSubIssues as never, user, { q } as never, seed.a.slug, id);
  const rel = (user: string, id: string, body: unknown) => call(R.createRelation as never, user, { method: "POST", body: JSON.stringify(body) }, seed.a.slug, id);
  const bulk = (user: string, body: unknown) => call(H.bulkIssues as never, user, { method: "POST", body: JSON.stringify(body) }, seed.a.slug);
  const asOwner = <T2>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T2>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T2>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); teamB = randomUUID();
    for (const [ws, t, key, m] of [[seed.a.id, teamA, "ENG", seed.a.member], [seed.a.id, teamA2, "OPS", null], [seed.b.id, teamB, "ENG", seed.b.member]] as const) await asOwner(ws, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${ws}, ${key}, ${key})`;
      if (m) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${t}, ${m})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("parent rules: team mismatch, hidden team, soft-deleted, unknown, foreign, cycle, depth are all 422", async () => {
    const p = await mk(seed.a.member, { team_id: teamA, title: "p" });
    const other = await mk(seed.a.owner, { team_id: teamA2, title: "other-team" });
    expect((await post(seed.a.owner, { team_id: teamA, title: "x", parent_id: other.id })).status).toBe(422); // team mismatch (visible to owner)
    const hid = await post(seed.a.member, { team_id: teamA, title: "x", parent_id: other.id }); // hidden to the member
    expect(hid.status).toBe(422);
    const hidMsg = (await hid.json()).error.message;
    const unk = await post(seed.a.member, { team_id: teamA, title: "x", parent_id: randomUUID() });
    expect(unk.status).toBe(422);
    expect((await unk.json()).error.message).toBe(hidMsg); // no existence leak
    const foreign = await mk(seed.b.member, { team_id: teamB, title: "f" }, seed.b.slug);
    expect((await post(seed.a.member, { team_id: teamA, title: "x", parent_id: foreign.id })).status).toBe(422);
    const gone = await mk(seed.a.member, { team_id: teamA, title: "gone" });
    expect((await call(H.deleteIssue as never, seed.a.member, { method: "DELETE", headers: { "if-match": '"1"' } }, seed.a.slug, gone.id)).status).toBe(204);
    expect((await post(seed.a.member, { team_id: teamA, title: "x", parent_id: gone.id })).status).toBe(422);
    const c = await mk(seed.a.member, { team_id: teamA, title: "c", parent_id: p.id });
    expect(c.parent).toMatchObject({ id: p.id, identifier: p.identifier, title: "p" });
    expect(p.parent).toBeNull();
    // PATCH: team mismatch, self, cycle
    const o2 = await mk(seed.a.owner, { team_id: teamA2, title: "o2" });
    expect((await patch(o2.id, 1, { parent_id: p.id }, seed.a.owner)).status).toBe(422);
    expect((await patch(p.id, 1, { parent_id: p.id })).status).toBe(422);
    expect((await patch(p.id, 1, { parent_id: c.id })).status).toBe(422);
    // team_id is not patchable (strict body), so a parent or child cannot be moved away from its team
    expect((await patch(p.id, 1, { team_id: teamA2 }, seed.a.owner)).status).toBe(422);
    expect((await patch(c.id, 1, { team_id: teamA2 }, seed.a.owner)).status).toBe(422);
    // depth: chain of 5 is the max
    let prev = await mk(seed.a.member, { team_id: teamA, title: "d1" });
    for (let i = 2; i <= 5; i++) prev = await mk(seed.a.member, { team_id: teamA, title: `d${i}`, parent_id: prev.id });
    expect((await post(seed.a.member, { team_id: teamA, title: "d6", parent_id: prev.id })).status).toBe(422);
  });

  it("sub-issues list: pagination, descendants with depth, hidden children skipped, 404 for hidden parent", async () => {
    const p = await mk(seed.a.member, { team_id: teamA, title: "root" });
    const kids: J[] = [];
    for (let i = 0; i < 3; i++) kids.push(await mk(seed.a.member, { team_id: teamA, title: `k${i}`, parent_id: p.id }));
    const gc = await mk(seed.a.member, { team_id: teamA, title: "gc", parent_id: kids[0]!.id });
    const ggc = await mk(seed.a.member, { team_id: teamA, title: "ggc", parent_id: gc.id });
    const p1 = await (await subs(seed.a.member, p.id, "?limit=2")).json();
    expect(p1.items.map((i: J) => i.title)).toEqual(["k0", "k1"]);
    const p2 = await (await subs(seed.a.member, p.id, `?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`)).json();
    expect(p2.items.map((i: J) => i.title)).toEqual(["k2"]); expect(p2.next_cursor).toBeNull();
    expect(p1.items[0]).not.toHaveProperty("depth");
    const d = await (await subs(seed.a.member, p.id, "?include=descendants")).json();
    expect(Object.fromEntries(d.items.map((i: J) => [i.title, i.depth]))).toEqual({ k0: 1, k1: 1, k2: 1, gc: 2, ggc: 3 });
    // cursor of one list is not valid for the other
    expect((await subs(seed.a.member, p.id, `?include=descendants&cursor=${encodeURIComponent(p1.next_cursor)}`)).status).toBe(400);
    // deleted child (and its subtree) leaves the list
    expect((await call(H.deleteIssue as never, seed.a.member, { method: "DELETE", headers: { "if-match": '"1"' } }, seed.a.slug, kids[0]!.id)).status).toBe(204);
    const d2 = await (await subs(seed.a.member, p.id, "?include=descendants")).json();
    expect(d2.items.map((i: J) => i.title).sort()).toEqual(["k1", "k2"]);
    expect(ggc.id).toBeTruthy();
    // hidden parent: 404 for member of another team and for guest; foreign workspace too
    const hidden = await mk(seed.a.owner, { team_id: teamA2, title: "hidden-parent" });
    expect((await subs(seed.a.member, hidden.id)).status).toBe(404);
    expect((await subs(seed.a.guest, p.id)).status).toBe(404);
    expect((await subs(seed.b.member, p.id)).status).toBe(404);
    expect((await subs(seed.a.member, p.id, "?include=nope")).status).toBe(422);
  });

  it("rollup: own + children sum with nulls, in_progress counter, parent_id=none filter, list DTO carries both", async () => {
    const p = await mk(seed.a.member, { team_id: teamA, title: "rollup", estimate: 3 });
    expect(p.estimate_rollup).toEqual({ own: 3, children: null, total: 3 });
    await mk(seed.a.member, { team_id: teamA, title: "r1", parent_id: p.id, estimate: 2, status: "in_progress" });
    await mk(seed.a.member, { team_id: teamA, title: "r2", parent_id: p.id });
    await mk(seed.a.member, { team_id: teamA, title: "r3", parent_id: p.id, estimate: 5, status: "done" });
    const g = await get(p.id);
    expect(g.estimate_rollup).toEqual({ own: 3, children: 7, total: 10 });
    expect(g.sub_issues).toEqual({ total: 3, done: 1, in_progress: 1 });
    const bare = await mk(seed.a.member, { team_id: teamA, title: "bare" });
    expect(bare.estimate_rollup).toEqual({ own: null, children: null, total: 0 });
    const l = await (await call(H.listIssues as never, seed.a.member, { q: "?limit=100&parent_id=none" } as never, seed.a.slug)).json();
    const row = l.items.find((i: J) => i.id === p.id);
    expect(row.estimate_rollup.total).toBe(10); expect(row.sub_issues.in_progress).toBe(1);
    expect(l.items.every((i: J) => i.parent_id === null)).toBe(true);
    expect((await call(H.listIssues as never, seed.a.member, { q: "?parent_id=nope" } as never, seed.a.slug)).status).toBe(422);
  });

  it("relations: related_issue summary, 409 carries relation_id + type, cancel_source", async () => {
    const a = await mk(seed.a.member, { team_id: teamA, title: "ra" }), b = await mk(seed.a.member, { team_id: teamA, title: "rb", priority: 2 });
    const r = await rel(seed.a.member, a.id, { type: "blocks", related_issue_id: b.id });
    const rj = await r.json();
    expect(r.status).toBe(201);
    expect(rj.related_issue).toEqual({ id: b.id, identifier: b.identifier, title: "rb", status: "backlog", priority: 2, assignee_id: null, team_id: teamA });
    const list = (await (await call(R.listRelations as never, seed.a.member, {}, seed.a.slug, b.id)).json()).items;
    expect(list[0]).toMatchObject({ type: "blocked_by", related_issue: { id: a.id, title: "ra", identifier: a.identifier } });
    const dup = await rel(seed.a.member, b.id, { type: "related", related_issue_id: a.id });
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.details).toEqual({ relation_id: rj.id, type: "blocked_by" });
    const d1 = await mk(seed.a.member, { team_id: teamA, title: "d1", status: "todo" }), d2 = await mk(seed.a.member, { team_id: teamA, title: "d2", status: "todo" });
    expect((await rel(seed.a.member, d1.id, { type: "duplicate", related_issue_id: a.id, cancel_source: false })).status).toBe(201);
    expect((await get(d1.id)).status).toBe("todo");
    expect((await rel(seed.a.member, d2.id, { type: "duplicate", related_issue_id: a.id, cancel_source: true })).status).toBe(201);
    const c = await get(d2.id); expect(c.status).toBe("canceled"); expect(c.version).toBe(2);
    expect((await rel(seed.a.member, a.id, { type: "related", related_issue_id: d1.id, cancel_source: "yes" })).status).toBe(422);
  });

  it("reorder: PATCH move before/after among siblings; non-siblings 422; version bumps", async () => {
    const p = await mk(seed.a.member, { team_id: teamA, title: "mv" });
    const [x, y, z] = [await mk(seed.a.member, { team_id: teamA, title: "x", parent_id: p.id }), await mk(seed.a.member, { team_id: teamA, title: "y", parent_id: p.id }), await mk(seed.a.member, { team_id: teamA, title: "z", parent_id: p.id })] as [J, J, J];
    const order = async () => (await (await subs(seed.a.member, p.id)).json()).items.map((i: J) => i.title).join("");
    expect(await order()).toBe("xyz");
    const r1 = await patch(z.id, 1, { move: { before_id: x.id } }); expect(r1.status).toBe(200); expect((await r1.json()).version).toBe(2);
    expect(await order()).toBe("zxy");
    expect((await patch(z.id, 2, { move: { after_id: y.id } })).status).toBe(200);
    expect(await order()).toBe("xyz");
    expect((await patch(x.id, 1, { move: { after_id: y.id } })).status).toBe(200);
    expect(await order()).toBe("yxz");
    expect((await patch(y.id, 1, { move: { before_id: p.id } })).status).toBe(422); // p is not a sibling
    expect((await patch(y.id, 1, { move: { before_id: y.id } })).status).toBe(422);
    expect((await patch(y.id, 1, { move: { before_id: x.id, after_id: z.id } })).status).toBe(422);
    expect((await patch(y.id, 7, { move: { before_id: x.id } })).status).toBe(412);
  });

  it("estimate-scale route and bulk estimate / labels / versions / delete / restore", async () => {
    const sc0 = await (await call(T.getEstimateScale as never, seed.a.member, {}, seed.a.slug, teamA)).json();
    expect(sc0).toEqual({ scale: "none", allow_zero: false, values: [] });
    await asOwner(seed.a.id, (tx) => tx`update team_settings set estimate_scale = 'fibonacci', estimate_allow_zero = true where team_id = ${teamA}`);
    expect(await (await call(T.getEstimateScale as never, seed.a.member, {}, seed.a.slug, teamA)).json()).toEqual({ scale: "fibonacci", allow_zero: true, values: [0, 1, 2, 3, 5, 8] });
    expect((await call(T.getEstimateScale as never, seed.a.member, {}, seed.a.slug, teamA2)).status).toBe(404); // not in that team
    expect((await call(T.getEstimateScale as never, seed.a.guest, {}, seed.a.slug, teamA)).status).toBe(403);
    expect(await (await call(T.getEstimateScale as never, seed.a.admin, {}, seed.a.slug, teamA2)).json()).toMatchObject({ scale: "none" }); // admin outside the team passes
    expect((await call(T.getEstimateScale as never, seed.b.member, {}, seed.a.slug, teamA)).status).toBe(404);

    const a = await mk(seed.a.member, { team_id: teamA, title: "ba" }), b = await mk(seed.a.member, { team_id: teamA, title: "bb" });
    const lab = randomUUID();
    await asOwner(seed.a.id, (tx) => tx`insert into labels (id, workspace_id, name) values (${lab}, ${seed.a.id}, 'a4-bulk')`);
    const ok = await (await bulk(seed.a.member, { ids: [a.id, b.id], patch: { estimate: 5, add_label_ids: [lab] }, versions: { [a.id]: 1 } })).json();
    expect(ok).toMatchObject({ succeeded: [a.id, b.id], failed: [] });
    const ga = await get(a.id); expect(ga).toMatchObject({ estimate: 5, label_ids: [lab], version: 2 });
    const bad = await (await bulk(seed.a.member, { ids: [a.id, b.id], patch: { estimate: 4 } })).json(); // 4 not in the scale
    expect(bad.succeeded).toEqual([]); expect(bad.failed).toHaveLength(2); expect(bad.failed[0].code).toBe("validation_failed");
    const stale = await (await bulk(seed.a.member, { ids: [a.id, b.id], patch: { remove_label_ids: [lab], estimate: null }, versions: { [a.id]: 1, [b.id]: 2 } })).json();
    expect(stale.succeeded).toEqual([b.id]); expect(stale.failed).toMatchObject([{ id: a.id, code: "precondition_failed", details: { current_version: 2 } }]);
    expect(await get(b.id)).toMatchObject({ estimate: null, label_ids: [], version: 3 });
    const del = await (await bulk(seed.a.member, { ids: [a.id, b.id], action: "delete" })).json(); expect(del.succeeded).toHaveLength(2);
    expect((await call(H.getIssue as never, seed.a.member, {}, seed.a.slug, a.id)).status).toBe(404);
    const res = await (await bulk(seed.a.member, { ids: [a.id], action: "restore" })).json(); expect(res.succeeded).toEqual([a.id]);
    expect((await get(a.id)).version).toBe(4);
    expect((await bulk(seed.a.guest, { ids: [a.id], action: "delete" })).status).toBe(403);
    expect((await bulk(seed.a.member, { ids: [a.id], patch: { estimate: 1 }, extra: 1 })).status).toBe(422);
  });
});
