import postgres from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";
import { uuidv7 } from "../../src/lib/uuid7";
import { setSessionResolver } from "../../src/lib/http/ctx";
import { searchWorkspace } from "../../src/lib/search/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DATABASE_URL / DATABASE_OWNER_URL are unset: integration tests must not skip");
const run = haveDb ? describe : describe.skip;
type Tx = postgres.TransactionSql;
type Hit = { kind: string; id: string; issue_id: string | null; identifier: string | null; title: string; snippet: string; rank: number; team_id: string | null };

run("A8 search_workspace RPC", () => {
  const app = appSql(), owner = ownerSql();
  let seed: Seed; let teamA: string; let teamB: string; let teamOther: string;
  let issueShared: string, issueTeam: string, issueOther: string, issueDeleted: string, projectA: string, projectOther: string, commentTeam: string;
  const search = (ws: string, role: string, user: string, q: string, o: { kinds?: string[]; limit?: number; team?: string; afterRank?: number | null; afterId?: string | null } = {}) =>
    withWorkspace(app, ws, async (tx) => { await tx`select set_config('app.user_id', ${user}, true)`; return tx<Hit[]>`select * from search_workspace(${q}, ${o.kinds ?? ["issue", "comment", "project"]}::text[], ${o.limit ?? 20},
      null, ${o.team ?? null}::uuid, null, null, null, ${o.afterRank ?? null}::float8, ${o.afterId ?? null}::uuid)`; });
  const mkTeam = (tx: Tx, ws: string, key: string) => tx`insert into teams (id, workspace_id, name, key) values (${uuidv7()}, ${ws}, ${key}, ${key}) returning id`.then((r) => r[0]!.id as string);
  const mkIssue = async (tx: Tx, ws: string, team: string, n: number, by: string, title: string, desc = "", deleted = false) => {
    const id = uuidv7();
    await tx`insert into issues (id, workspace_id, team_id, number, title, description, sort_key, created_by, deleted_at) values (${id}, ${ws}, ${team}, ${n}, ${title}, ${desc}, ${`a${n}`}, ${by}, ${deleted ? new Date() : null})`;
    return id;
  };

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    const a = seed.a;
    await withWorkspace(owner, a.id, async (tx) => {
      teamA = await mkTeam(tx, a.id, "ENG"); teamB = await mkTeam(tx, a.id, "OPS"); teamOther = await mkTeam(tx, a.id, "LEG");
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${a.id}, ${teamA}, ${a.member})`;
      issueTeam = await mkIssue(tx, a.id, teamA, 1, a.member, "Quokka rendering bug", "the quokka widget flickers");
      issueShared = await mkIssue(tx, a.id, teamB, 1, a.admin, "Quokka export", "shared with the guest");
      issueOther = await mkIssue(tx, a.id, teamOther, 1, a.admin, "Quokka secret roadmap");
      issueDeleted = await mkIssue(tx, a.id, teamA, 2, a.member, "Quokka deleted", "", true);
      await tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${a.id}, ${issueShared}, ${a.guest}, ${a.admin})`;
      commentTeam = uuidv7();
      await tx`insert into comments (id, workspace_id, issue_id, author_id, body) values (${commentTeam}, ${a.id}, ${issueTeam}, ${a.member}, ${"quokka comment on team issue"}),
        (${uuidv7()}, ${a.id}, ${issueOther}, ${a.admin}, ${"quokka comment on hidden issue"})`;
      projectA = uuidv7(); projectOther = uuidv7();
      await tx`insert into projects (id, workspace_id, name, description) values (${projectA}, ${a.id}, ${"Quokka launch"}, ${""}), (${projectOther}, ${a.id}, ${"Quokka legal"}, ${""})`;
      await tx`insert into project_teams (workspace_id, project_id, team_id) values (${a.id}, ${projectA}, ${teamA}), (${a.id}, ${projectOther}, ${teamOther})`;
    });
    await withWorkspace(owner, seed.b.id, async (tx) => {
      const t = await mkTeam(tx, seed.b.id, "ENG");
      await mkIssue(tx, seed.b.id, t, 1, seed.b.admin, "Quokka other tenant");
    });
  });
  afterAll(async () => { await app.end(); await owner.end(); });

  it("admin sees every live issue, comment and project of the workspace, never soft-deleted or other tenants", async () => {
    const r = await search(seed.a.id, "admin", seed.a.admin, "quokka");
    const ids = new Set(r.map((h) => h.id));
    expect([issueTeam, issueShared, issueOther, projectA, projectOther, commentTeam].every((i) => ids.has(i))).toBe(true);
    expect(ids.has(issueDeleted)).toBe(false);
    expect(r.some((h) => h.title.includes("other tenant"))).toBe(false);
  });

  it("member only sees their team's issues, comments and projects", async () => {
    const r = await search(seed.a.id, "member", seed.a.member, "quokka");
    expect(new Set(r.map((h) => h.id))).toEqual(new Set([issueTeam, commentTeam, projectA]));
  });

  it("guest gets 0 hits outside their shares (no hidden issue, comment or project), and only the shared issue", async () => {
    const r = await search(seed.a.id, "guest", seed.a.guest, "quokka");
    expect(r.map((h) => h.id)).toEqual([issueShared]);
    expect(await search(seed.a.id, "guest", seed.a.guest, "roadmap")).toHaveLength(0);
    expect(await search(seed.a.id, "guest", seed.a.guest, "ENG-1")).toHaveLength(0);
  });

  it("a revoked share stops matching", async () => {
    await withWorkspace(owner, seed.a.id, (tx) => tx`update issue_shares set revoked_at = now() where issue_id = ${issueShared}`);
    expect(await search(seed.a.id, "guest", seed.a.guest, "quokka")).toHaveLength(0);
    await withWorkspace(owner, seed.a.id, (tx) => tx`update issue_shares set revoked_at = null where issue_id = ${issueShared}`);
  });

  it("lookup by TEAM-123 returns the exact issue first, case-insensitively, and nothing across visibility", async () => {
    const r = await search(seed.a.id, "admin", seed.a.admin, "eng-1");
    expect(r[0]!.id).toBe(issueTeam);
    expect(r[0]!.identifier).toBe("ENG-1");
    expect(await search(seed.a.id, "member", seed.a.member, "LEG-1")).toHaveLength(0);
  });

  it("prefix match on the last token, snippet highlights with <mark>", async () => {
    const r = await search(seed.a.id, "admin", seed.a.admin, "quok", { kinds: ["issue"] });
    expect(r.length).toBeGreaterThanOrEqual(3);
    expect(r[0]!.snippet).toContain("<mark>");
    expect(await search(seed.a.id, "admin", seed.a.admin, "q")).toHaveLength(0); // one char: no prefix expansion, no match
  });

  it("websearch syntax: quotes, OR and minus", async () => {
    expect((await search(seed.a.id, "admin", seed.a.admin, '"quokka export"', { kinds: ["issue"] })).map((h) => h.id)).toEqual([issueShared]);
    expect((await search(seed.a.id, "admin", seed.a.admin, "quokka -export ", { kinds: ["issue"] })).map((h) => h.id)).not.toContain(issueShared);
  });

  it.each(["quokka'", "quokka & | !", "qu:*", "'; drop table issues; --", "quokka:", "!!", "(", "quokka &", "", "   ", "a|b:*c", '"unterminated'])("hostile query %j never errors", async (q) => {
    await expect(search(seed.a.id, "admin", seed.a.admin, q)).resolves.toBeDefined();
  });

  it("keyset cursor pages without gaps, duplicates or leaks", async () => {
    const all = await search(seed.a.id, "admin", seed.a.admin, "quokka", { limit: 100 });
    const seen: string[] = []; let after: { r: number; id: string } | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const p: Hit[] = await search(seed.a.id, "admin", seed.a.admin, "quokka", { limit: 2, afterRank: after?.r ?? null, afterId: after?.id ?? null });
      if (p.length === 0) break;
      seen.push(...p.map((h) => h.id)); after = { r: p[p.length - 1]!.rank, id: p[p.length - 1]!.id };
    }
    expect(seen).toEqual(all.map((h) => h.id));
  });

  it("team filter narrows issues and projects", async () => {
    const r = await search(seed.a.id, "admin", seed.a.admin, "quokka", { team: teamOther });
    expect(new Set(r.map((h) => h.id))).toEqual(new Set([issueOther, projectOther]).add(r.find((h) => h.kind === "comment")!.id));
  });

  it("identity comes from the session: old (role, user) signature is gone, no user setting means no rows", async () => {
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`select * from search_workspace('owner', ${seed.a.admin}::uuid, 'quokka')`)).rejects.toThrow();
    expect(await withWorkspace(app, seed.a.id, (tx) => tx<Hit[]>`select * from search_workspace('quokka')`)).toHaveLength(0);
    // a member of workspace A acting inside workspace B sees nothing (role is looked up in the current workspace)
    expect(await search(seed.b.id, "admin", seed.a.member, "quokka")).toHaveLength(0);
  });

  it("punctuation-only tails produce no NOTICE and no error", async () => {
    const notices: string[] = [];
    const sql = postgres(process.env.DATABASE_URL as string, { max: 1, onnotice: (n) => notices.push(String(n.message)) });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; await tx`select set_config('app.user_id', ${seed.a.admin}, true)`;
      for (const q of ["quokka ---", "foo ---", "---", "!!! &&"]) await tx`select * from search_workspace(${q})`;
    });
    await sql.end();
    expect(notices).toEqual([]);
  });

  it("anonymous (no tenant set) sees nothing", async () => {
    const r = await withWorkspace(app, null, async (tx) => { await tx`select set_config('app.user_id', ${seed.a.admin}, true)`; return tx<Hit[]>`select * from search_workspace('quokka')`; });
    expect(r).toHaveLength(0);
  });

  it("HTTP handler: guest 0 hits outside shares, cursor pages, validation errors", async () => {
    const get = async (user: string, qs: string) => { setSessionResolver(async () => user); const r = await searchWorkspace(new Request(`http://localhost/api/v1/w/${seed.a.slug}/search?${qs}`), seed.a.slug); return { status: r.status, body: await r.json() as { items: Hit[]; next_cursor: string | null } }; };
    const g = await get(seed.a.guest, "q=quokka");
    expect(g.status).toBe(200); expect(g.body.items.map((h) => h.id)).toEqual([issueShared]);
    expect((await get(seed.a.guest, "q=roadmap")).body.items).toHaveLength(0);
    const seen: string[] = []; let cursor = "";
    for (let i = 0; i < 10; i++) {
      const r = await get(seed.a.admin, `q=quokka&limit=2${cursor}`);
      seen.push(...r.body.items.map((h) => h.id));
      if (!r.body.next_cursor) break;
      cursor = `&cursor=${encodeURIComponent(r.body.next_cursor)}`;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe((await get(seed.a.admin, "q=quokka&limit=100")).body.items.length);
    expect((await get(seed.a.admin, "q=")).status).toBe(422);
    expect((await get(seed.a.admin, "q=quokka&cursor=garbage")).status).toBe(400);
    expect((await get(seed.a.admin, "q=eng-1")).body.items[0]!.identifier).toBe("ENG-1");
  });
});
