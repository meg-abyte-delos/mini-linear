import postgres from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";
import { uuidv7 } from "../../src/lib/uuid7";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import { searchWorkspace } from "../../src/lib/search/handlers";
import { addRecent, clearRecents, deleteRecent, listRecents } from "../../src/lib/search/recents";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DATABASE_URL / DATABASE_OWNER_URL are unset: integration tests must not skip");
type Tx = postgres.TransactionSql;
type Hit = { kind: string; id: string; issue_id: string | null; identifier: string | null; title: string; snippet: string; rank: number; updated_at: string; parent_identifier: string | null; matched: string[] };
type Rec = { id: string; query: string | null; entity_id: string | null };
type Res = { status: number; body: { items: (Hit & Rec)[]; next_cursor: string; error?: { code: string }; code?: string } };

(haveDb ? describe : describe.skip)("A7 search: filters, kinds, sort, recents", { timeout: 60000 }, () => {
  const owner = ownerSql();
  let seed: Seed; let teamA: string, teamB: string, cycle: string, doneState: string;
  const ids = {} as Record<"parent" | "child" | "done" | "descOnly" | "other" | "shared" | "xss" | "projA" | "projB", string>;
  const mkIssue = async (tx: Tx, team: string, n: number, title: string, o: { desc?: string; priority?: number; due?: string; status?: string; parent?: string; cycle?: string; upd?: string } = {}) => {
    const id = uuidv7();
    await tx`insert into issues (id, workspace_id, team_id, number, title, description, priority, due_date, parent_id, cycle_id, sort_key, created_by)
      values (${id}, ${seed.a.id}, ${team}, ${n}, ${title}, ${o.desc ?? ""}, ${o.priority ?? 0}, ${o.due ?? null}, ${o.parent ?? null}, ${o.cycle ?? null}, ${`a${n}`}, ${seed.a.admin})`;
    if (o.status) await tx`update issues set status = ${o.status}::issue_status where id = ${id}`;
    if (o.upd) await tx`update issues set updated_at = ${o.upd}::timestamptz where id = ${id}`;
    return id;
  };
  const get = async (user: string, qs: string, ws = seed.a): Promise<Res> => {
    setSessionResolver(async () => user);
    const r = await searchWorkspace(new Request(`http://localhost/api/v1/w/${ws.slug}/search?${qs}`), ws.slug);
    return { status: r.status, body: await r.json() } as Res;
  };
  const idsOf = (r: Res) => (r.body.items as Hit[]).map((h) => h.id);
  const recent = async (fn: (req: Request, slug: string, ...a: string[]) => Promise<Response>, user: string, method: string, body?: unknown, ...a: string[]) => {
    setSessionResolver(async () => user);
    const r = await fn(new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), seed.a.slug, ...a);
    return { status: r.status, body: r.status === 204 ? null : await r.json() } as unknown as Res;
  };

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    const a = seed.a;
    await withWorkspace(owner, a.id, async (tx) => {
      teamA = uuidv7(); teamB = uuidv7(); cycle = uuidv7();
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${a.id}, 'Alpha', 'ALP'), (${teamB}, ${a.id}, 'Beta', 'BET')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${a.id}, ${teamA}, ${a.member})`;
      await tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${cycle}, ${a.id}, ${teamA}, 'c1', '2040-01-01', '2040-01-05')`;
      doneState = (await tx<{ id: string }[]>`select id from workflow_states where team_id = ${teamA} and legacy_status = 'done'`)[0]!.id;
      ids.parent = await mkIssue(tx, teamA, 1, "Zebra epic", { desc: "umbrella", upd: "2040-03-01T00:00:00.123456Z" });
      ids.child = await mkIssue(tx, teamA, 2, "Zebra child task", { priority: 2, due: "2040-02-10", parent: ids.parent, cycle, upd: "2040-03-02T00:00:00.654321Z" });
      ids.done = await mkIssue(tx, teamA, 3, "Zebra finished", { priority: 4, due: "2040-05-01", status: "done", upd: "2040-03-03T00:00:00Z" });
      ids.descOnly = await mkIssue(tx, teamA, 4, "Plain title", { desc: "contains zebra in body", priority: 2 });
      ids.other = await mkIssue(tx, teamB, 1, "Zebra secret of team B", { priority: 2, due: "2040-02-10" });
      ids.shared = await mkIssue(tx, teamB, 2, "Zebra shared with guest");
      ids.xss = await mkIssue(tx, teamA, 5, "Pwn", { desc: "zebra <img src=x onerror=alert(1)> & \"q\" \ue000<script>x</script>\ue001 <mark onclick=1>zebra</mark>" });
      await tx`update issues set state_id = ${doneState} where id = ${ids.done}`;
      await tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${a.id}, ${ids.shared}, ${a.guest}, ${a.admin})`;
      await tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by) values
        (${uuidv7()}, ${a.id}, ${ids.child}, 'link', 'https://x.test/1', 'Zebra design spec', ${a.admin}),
        (${uuidv7()}, ${a.id}, ${ids.other}, 'link', 'https://x.test/2', 'Zebra hidden spec', ${a.admin})`;
      await tx`insert into comments (id, workspace_id, issue_id, author_id, body) values (${uuidv7()}, ${a.id}, ${ids.parent}, ${a.admin}, 'zebra comment')`;
      ids.projA = uuidv7(); ids.projB = uuidv7();
      await tx`insert into projects (id, workspace_id, name, description) values (${ids.projA}, ${a.id}, 'Zebra launch', ''), (${ids.projB}, ${a.id}, 'Zebra legal', '')`;
      await tx`insert into project_teams (workspace_id, project_id, team_id) values (${a.id}, ${ids.projA}, ${teamA}), (${a.id}, ${ids.projB}, ${teamB})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("rejects bad q: empty, 201 chars, NUL byte (422, never 500)", async () => {
    expect((await get(seed.a.admin, "q=")).status).toBe(422);
    expect((await get(seed.a.admin, "")).status).toBe(422);
    expect((await get(seed.a.admin, `q=${"x".repeat(201)}`)).status).toBe(422);
    const nul = await get(seed.a.admin, "q=a%00b");
    expect(nul.status).toBe(422); expect(nul.body.error?.code ?? nul.body.code).toBe("validation_failed");
    expect((await get(seed.a.admin, "q=zebra&team_id=a%00b")).status).toBe(422);
    expect((await get(seed.a.admin, "q=%00")).status).toBe(422);
  });

  it("kind accepts a comma list and attachment; unknown kind is 422; default excludes attachments", async () => {
    const all = await get(seed.a.admin, "q=zebra&limit=100");
    expect(all.body.items.some((h: Hit) => h.kind === "attachment")).toBe(false);
    const ip = await get(seed.a.admin, "q=zebra&kind=issue,project&limit=100");
    expect(new Set(ip.body.items.map((h: Hit) => h.kind))).toEqual(new Set(["issue", "project"]));
    const att = await get(seed.a.admin, "q=zebra&kind=attachment&limit=100");
    expect(att.body.items.map((h: Hit) => h.title).sort()).toEqual(["Zebra design spec", "Zebra hidden spec"]);
    expect(att.body.items[0]!.matched).toEqual(["attachment"]);
    for (const k of ["foo", "issue,foo", "user", ",", "view"]) expect((await get(seed.a.admin, `q=zebra&kind=${k}`)).status).toBe(422);
  });

  it("attachment hits obey the visibility of their issue (member of A never sees team B's, guest sees none)", async () => {
    const m = await get(seed.a.member, "q=zebra&kind=attachment&limit=100");
    expect(m.body.items.map((h: Hit) => h.title)).toEqual(["Zebra design spec"]);
    expect((await get(seed.a.guest, "q=zebra&kind=attachment")).body.items).toHaveLength(0);
  });

  it("pending and soft-deleted attachments are never hits (A8 columns, added here only if 0805 is not applied)", async () => {
    const had = (await owner`select 1 from information_schema.columns where table_name = 'issue_attachments' and column_name = 'upload_status'`).length > 0;
    if (!had) await owner`alter table issue_attachments add column upload_status text not null default 'ready', add column deleted_at timestamptz`;
    try {
      const pend = uuidv7(), del = uuidv7(), ok = uuidv7();
      await withWorkspace(owner, seed.a.id, async (tx) => {
        await tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by, upload_status) values
          (${pend}, ${seed.a.id}, ${ids.parent}, 'file', 'https://x.test/p', 'Narwhal pending', ${seed.a.admin}, 'pending')`;
        await tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by, deleted_at) values
          (${del}, ${seed.a.id}, ${ids.parent}, 'link', 'https://x.test/d', 'Narwhal deleted', ${seed.a.admin}, now())`;
        await tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, created_by) values
          (${ok}, ${seed.a.id}, ${ids.parent}, 'link', 'https://x.test/o', 'Narwhal ready', ${seed.a.admin})`;
      });
      expect(idsOf(await get(seed.a.admin, "q=narwhal&kind=attachment"))).toEqual([ok]);
      expect(idsOf(await get(seed.a.admin, "q=zebra&kind=issue&has_attachment=true&limit=100"))).toContain(ids.parent);
      await withWorkspace(owner, seed.a.id, (tx) => tx`delete from issue_attachments where id = ${ok}`);
      expect(idsOf(await get(seed.a.admin, "q=zebra&kind=issue&has_attachment=true&limit=100"))).not.toContain(ids.parent); // only pending/deleted left
    } finally {
      await withWorkspace(owner, seed.a.id, (tx) => tx`delete from issue_attachments where title like 'Narwhal%'`);
      if (!had) await owner`alter table issue_attachments drop column upload_status, drop column deleted_at`;
    }
  });

  it("each filter alone", async () => {
    const f = async (qs: string) => idsOf(await get(seed.a.admin, `q=zebra&kind=issue&limit=100&${qs}`));
    expect(await f("priority=4")).toEqual([ids.done]);
    expect(new Set(await f("priority=2"))).toEqual(new Set([ids.child, ids.descOnly, ids.other]));
    expect(await f(`cycle_id=${cycle}`)).toEqual([ids.child]);
    expect(await f(`state_id=${doneState}`)).toEqual([ids.done]);
    expect(new Set(await f("due_before=2040-02-10"))).toEqual(new Set([ids.child, ids.other]));
    expect(new Set(await f("due_after=2040-02-11"))).toEqual(new Set([ids.done]));
    expect(await f("has_attachment=true").then((x) => new Set(x))).toEqual(new Set([ids.child, ids.other]));
    expect(await f("has_attachment=false")).not.toContain(ids.child);
    expect(await f("include_done=false")).not.toContain(ids.done);
    expect(await f("include_done=true")).toContain(ids.done);
    expect(await f("status=done")).toEqual([ids.done]);
  });

  it("filters combined (AND)", async () => {
    const r = await get(seed.a.admin, `q=zebra&kind=issue&priority=2&due_before=2040-02-10&has_attachment=true&team_id=${teamA}`);
    expect(idsOf(r)).toEqual([ids.child]);
    expect(idsOf(await get(seed.a.admin, `q=zebra&kind=issue&priority=4&cycle_id=${cycle}`))).toEqual([]);
  });

  it("any issue-only filter drops projects; team filter keeps them", async () => {
    const base = await get(seed.a.admin, "q=zebra&kind=project");
    expect(idsOf(base)).toHaveLength(2);
    for (const qs of ["priority=2", `cycle_id=${cycle}`, `state_id=${doneState}`, "due_before=2041-01-01", "due_after=2000-01-01", "has_attachment=true", "include_done=false", "status=todo"])
      expect(idsOf(await get(seed.a.admin, `q=zebra&kind=project&${qs}`)), qs).toEqual([]);
    expect(idsOf(await get(seed.a.admin, `q=zebra&kind=project&team_id=${teamB}`))).toEqual([ids.projB]);
  });

  it("filter params validate: bad priority / date / uuid / bool are 422", async () => {
    for (const qs of ["priority=5", "priority=-1", "priority=x", "due_before=2040-13-01", "due_after=nope", "cycle_id=1", "state_id=1", "has_attachment=yes", "include_done=1", "sort=name"])
      expect((await get(seed.a.admin, `q=zebra&${qs}`)).status, qs).toBe(422);
  });

  it("member of team A never sees a team B hit, at any page boundary (limit=1)", async () => {
    const seen: string[] = []; let cursor = "";
    for (let i = 0; i < 30; i++) {
      const r = await get(seed.a.member, `q=zebra&kind=issue,comment,project,attachment&limit=1${cursor}`);
      expect(r.status).toBe(200); expect(r.body.items.length).toBeLessThanOrEqual(1);
      seen.push(...idsOf(r));
      if (!r.body.next_cursor) break; cursor = `&cursor=${encodeURIComponent(r.body.next_cursor)}`;
    }
    expect(seen).not.toContain(ids.other); expect(seen).not.toContain(ids.shared); expect(seen).not.toContain(ids.projB);
    expect(seen).toContain(ids.child); expect(new Set(seen).size).toBe(seen.length);
  });

  it("guest sees only shared issues, never projects, with issue-only filters too", async () => {
    const r = await get(seed.a.guest, "q=zebra&kind=issue,project,comment,attachment&limit=100");
    expect(idsOf(r)).toEqual([ids.shared]);
    expect(idsOf(await get(seed.a.guest, "q=zebra&priority=0"))).toEqual([ids.shared]);
  });

  it("sort=updated orders by updated_at desc with an exact cursor; a rank cursor on sort=updated is 400 (and vice versa)", async () => {
    const all = await get(seed.a.admin, "q=zebra&kind=issue&sort=updated&limit=100&team_id=" + teamA);
    const top3 = all.body.items.slice(0, 3).map((h: Hit) => h.id);
    expect(top3).toEqual([ids.done, ids.child, ids.parent].filter((x) => all.body.items.some((h: Hit) => h.id === x)).slice(0, 3));
    // updated_at of freshly written fixtures (now()) outranks 2040? no: 2040 > now, so the three 2040 rows lead
    expect(top3).toEqual([ids.done, ids.child, ids.parent]);
    const seen: string[] = []; let cursor = "";
    for (let i = 0; i < 20; i++) {
      const r = await get(seed.a.admin, `q=zebra&kind=issue&sort=updated&limit=2&team_id=${teamA}${cursor}`);
      seen.push(...idsOf(r)); if (!r.body.next_cursor) break; cursor = `&cursor=${encodeURIComponent(r.body.next_cursor)}`;
    }
    expect(seen).toEqual(idsOf(all));
    const rank = await get(seed.a.admin, "q=zebra&limit=1");
    expect(rank.body.next_cursor).toBeTruthy();
    expect((await get(seed.a.admin, `q=zebra&limit=1&sort=updated&cursor=${encodeURIComponent(rank.body.next_cursor)}`)).status).toBe(400);
    const upd = await get(seed.a.admin, "q=zebra&limit=1&sort=updated");
    expect((await get(seed.a.admin, `q=zebra&limit=1&sort=rank&cursor=${encodeURIComponent(upd.body.next_cursor)}`)).status).toBe(400);
    expect((await get(seed.a.admin, `q=zebra&limit=1&cursor=${encodeURIComponent(upd.body.next_cursor)}`)).status).toBe(400);
  });

  it("items carry updated_at, parent_identifier and matched", async () => {
    const r = await get(seed.a.admin, "q=zebra&kind=issue&limit=100");
    const by = (id: string) => (r.body.items as Hit[]).find((h) => h.id === id)!;
    expect(by(ids.child).parent_identifier).toBe("ALP-1");
    expect(by(ids.parent).parent_identifier).toBeNull();
    expect(by(ids.child).matched).toEqual(["title"]);
    expect(by(ids.descOnly).matched).toEqual(["description"]);
    expect(new Date(by(ids.child).updated_at).toISOString()).toBe("2040-03-02T00:00:00.654Z");
    const c = await get(seed.a.admin, "q=zebra&kind=comment");
    expect(c.body.items[0]!.matched).toEqual(["comment"]);
    // a guest sharing the child but not the parent never learns the parent identifier
    await withWorkspace(owner, seed.a.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${ids.child}, ${seed.a.guest}, ${seed.a.admin})`);
    const g = await get(seed.a.guest, "q=child&kind=issue");
    expect(idsOf(g)).toEqual([ids.child]); expect(g.body.items[0]!.parent_identifier).toBeNull();
    await withWorkspace(owner, seed.a.id, (tx) => tx`delete from issue_shares where issue_id = ${ids.child}`);
  });

  it("snippets are HTML-escaped except <mark>", async () => {
    const r = await get(seed.a.admin, "q=zebra&kind=issue&limit=100");
    const s = (r.body.items as Hit[]).find((h) => h.id === ids.xss)!.snippet;
    expect(s).toContain("<mark>zebra</mark>"); expect(s).not.toContain("<img"); expect(s).toContain("&lt;img"); expect(s).toContain("&amp;"); expect(s).toContain("&quot;q&quot;");
    expect(s.replace(/<\/?mark>/g, "")).not.toMatch(/[<>]/);
    expect(s).not.toMatch(/[\ue000\ue001]/); expect(s).not.toContain("<script"); expect(s).not.toContain("<mark onclick");
  });

  it("identifier query ranks that issue first", async () => {
    const r = await get(seed.a.admin, "q=alp-3&kind=issue,comment,project,attachment");
    expect(r.body.items[0]!.id).toBe(ids.done); expect(r.body.items[0]!.identifier).toBe("ALP-3");
  });

  it("workspace isolation: workspace B cannot see A's data, and A's slug is 404 for B's user", async () => {
    expect((await get(seed.b.admin, "q=zebra", seed.a)).status).toBe(404);
    expect(idsOf(await get(seed.b.admin, "q=zebra", seed.b))).toEqual([]);
    expect(idsOf(await get(seed.b.admin, `q=zebra&cycle_id=${cycle}&team_id=${teamA}`, seed.b))).toEqual([]);
  });

  it("recents: validation, dedupe, move to top, cap 50, list max 20, delete", async () => {
    const a = seed.a.member;
    expect((await recent(addRecent, a, "POST", { kind: "query" })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "x", entity_id: ids.child })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "issue", query: "x", entity_id: ids.child })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "issue" })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "issue", entity_id: "nope" })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "x", extra: 1 })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "a\u0000b" })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "y".repeat(201) })).status).toBe(422);
    expect((await recent(addRecent, a, "POST", { kind: "issue", entity_id: ids.other })).status).toBe(404); // not visible
    expect((await recent(addRecent, a, "POST", { kind: "project", entity_id: ids.projB })).status).toBe(404);
    expect((await recent(addRecent, a, "POST", { kind: "issue", entity_id: uuidv7() })).status).toBe(404);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "first" })).status).toBe(201);
    expect((await recent(addRecent, a, "POST", { kind: "issue", entity_id: ids.child })).status).toBe(201);
    expect((await recent(addRecent, a, "POST", { kind: "project", entity_id: ids.projA })).status).toBe(201);
    expect((await recent(addRecent, a, "POST", { kind: "query", query: "first" })).status).toBe(201); // dedupe: moves to top
    const l = await recent(listRecents, a, "GET");
    expect(l.body.items.map((i: Rec) => i.query ?? i.entity_id)).toEqual(["first", ids.projA, ids.child]);
    expect(l.body.items[0]!).toEqual(expect.objectContaining({ kind: "query", entity_id: null }));
    for (let i = 0; i < 60; i++) await recent(addRecent, a, "POST", { kind: "query", query: `q${i}` });
    expect((await recent(listRecents, a, "GET")).body.items).toHaveLength(20);
    const n = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; await tx`select set_config('app.user_id', ${a}, true)`; return Number((await tx`select count(*) from search_recents where user_id = ${a}`)[0]!.count); });
    expect(n).toBe(50);
    const top = (await recent(listRecents, a, "GET")).body.items[0]!;
    expect(top.query).toBe("q59");
    expect((await recent(deleteRecent, a, "DELETE", undefined, top.id)).status).toBe(204);
    expect((await recent(deleteRecent, a, "DELETE", undefined, top.id)).status).toBe(204); // idempotent
    expect((await recent(deleteRecent, a, "DELETE", undefined, "not-a-uuid")).status).toBe(400);
    expect((await recent(listRecents, a, "GET")).body.items[0]!.query).toBe("q58");
    expect((await recent(clearRecents, a, "DELETE")).status).toBe(204);
    expect((await recent(listRecents, a, "GET")).body.items).toEqual([]);
  });

  it("recents: per-user RLS, hidden entity dropped, guests issue only", async () => {
    const m = seed.a.member, ad = seed.a.admin;
    await recent(addRecent, m, "POST", { kind: "query", query: "mine" });
    await recent(addRecent, ad, "POST", { kind: "issue", entity_id: ids.other });
    expect((await recent(listRecents, m, "GET")).body.items.map((i: Rec) => i.query)).toEqual(["mine"]);
    const mine = (await recent(listRecents, m, "GET")).body.items[0]!.id;
    expect((await recent(deleteRecent, ad, "DELETE", undefined, mine)).status).toBe(204); // other user's row: no effect
    expect((await recent(listRecents, m, "GET")).body.items).toHaveLength(1);
    // visibility lost -> dropped from the list
    await recent(addRecent, m, "POST", { kind: "issue", entity_id: ids.child });
    expect((await recent(listRecents, m, "GET")).body.items).toHaveLength(2);
    await withWorkspace(owner, seed.a.id, (tx) => tx`delete from team_memberships where user_id = ${m} and team_id = ${teamA}`);
    expect((await recent(listRecents, m, "GET")).body.items.map((i: Rec) => i.query)).toEqual(["mine"]);
    await withWorkspace(owner, seed.a.id, (tx) => tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${m})`);
    await withWorkspace(owner, seed.a.id, (tx) => tx`update issues set deleted_at = now() where id = ${ids.child}`);
    expect((await recent(listRecents, m, "GET")).body.items.map((i: Rec) => i.query)).toEqual(["mine"]);
    await withWorkspace(owner, seed.a.id, (tx) => tx`update issues set deleted_at = null where id = ${ids.child}`);
    // guests: issue only
    const g = seed.a.guest;
    expect((await recent(addRecent, g, "POST", { kind: "query", query: "x" })).status).toBe(201); // queries are allowed for guests
    expect((await recent(addRecent, g, "POST", { kind: "project", entity_id: ids.projA })).status).toBe(403);
    expect((await recent(addRecent, g, "POST", { kind: "issue", entity_id: ids.other })).status).toBe(404);
    expect((await recent(addRecent, g, "POST", { kind: "issue", entity_id: ids.shared })).status).toBe(201);
    // other workspace
    setSessionResolver(async () => seed.b.admin);
    expect((await listRecents(new Request("http://x"), seed.a.slug)).status).toBe(404);
  });

  it("rate limit: 121st search within a minute is 429 rate_limited with Retry-After; recents are not limited", async () => {
    // The limiter is a fixed 60s window aligned on the clock: 121 hits straddling a minute boundary land in two buckets (flaky 200). Start right after a boundary when close to one.
    const intoWindow = Date.now() % 60_000;
    if (intoWindow > 45_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 250));
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await get(seed.a.owner, "q=zebra&limit=1")).status;
    expect(last).toBe(429);
    setSessionResolver(async () => seed.a.owner);
    const raw = await searchWorkspace(new Request(`http://localhost/x?q=zebra`), seed.a.slug);
    expect(raw.status).toBe(429); expect(Number(raw.headers.get("retry-after"))).toBeGreaterThanOrEqual(1); expect(Number(raw.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect((await raw.json()).error?.code).toBe("rate_limited");
    expect((await recent(listRecents, seed.a.owner, "GET")).status).toBe(200);
    expect((await get(seed.a.admin, "q=zebra&limit=1")).status).toBe(200); // other user, own bucket
  }, 30_000);

  it("unauthenticated: 401", async () => {
    setSessionResolver(async () => null);
    expect((await searchWorkspace(new Request("http://x/?q=a"), seed.a.slug)).status).toBe(401);
    expect((await listRecents(new Request("http://x"), seed.a.slug)).status).toBe(401);
  });
});
