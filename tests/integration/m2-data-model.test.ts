import postgres from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";
import { allocateIssueNumber } from "../../src/db/issues";
import { uuidv7 } from "../../src/lib/uuid7";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DATABASE_URL / DATABASE_OWNER_URL are unset: integration tests must not skip");
const run = haveDb ? describe : describe.skip;

const NEW_TABLES = ["projects", "project_teams", "cycles", "labels", "issues", "issue_labels", "comments", "issue_shares", "audit_events"];
type Tx = postgres.TransactionSql;

run("M2 data model", () => {
  const app = appSql(), owner = ownerSql();
  let seed: Seed; let teamA: string; let teamB: string;
  const mkTeam = (tx: Tx, ws: string, key: string) => tx`insert into teams (id, workspace_id, name, key) values (${uuidv7()}, ${ws}, ${key}, ${key}) returning id`.then((r) => r[0]!.id as string);
  const mkIssue = (tx: Tx, ws: string, team: string, by: string, parent: string | null = null, id = uuidv7()) =>
    allocateIssueNumber(tx, team).then((n) => tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by, parent_id)
      values (${id}, ${ws}, ${team}, ${n}, 't', 'a0', ${by}, ${parent}) returning id`).then((r) => r[0]!.id as string);

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    teamA = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "ENG"));
    teamB = await withWorkspace(app, seed.b.id, (tx) => mkTeam(tx, seed.b.id, "ENG")); // same key, other workspace: allowed
  });
  afterAll(async () => { await app.end(); await owner.end(); });

  it("S2/A1.2 every new table has FORCE RLS and returns 0 rows with app.workspace_id unset", async () => {
    await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, teamA, seed.a.member));
    for (const t of NEW_TABLES) {
      const flags = await owner`select relrowsecurity, relforcerowsecurity from pg_class where relname = ${t}`;
      expect(flags[0], t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect((await withWorkspace(app, null, (tx) => tx.unsafe(`select 1 from ${t}`))).length, t).toBe(0);
    }
  });

  it("A1.1 workspace B context never sees workspace A issues; WITH CHECK blocks cross-tenant inserts", async () => {
    const rows = await withWorkspace(app, seed.b.id, (tx) => tx`select id from issues`);
    expect(rows.length).toBe(0);
    await expect(withWorkspace(app, seed.b.id, (tx) =>
      tx`insert into labels (id, workspace_id, name) values (${uuidv7()}, ${seed.a.id}, 'x')`)).rejects.toThrow();
  });

  it("composite FK: an issue cannot reference another workspace's team, project or parent", async () => {
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values (${uuidv7()}, ${seed.a.id}, ${teamB}, 1, 't', 'a0', ${seed.a.member})`)).rejects.toThrow(/foreign key/);
    const projB = await withWorkspace(app, seed.b.id, (tx) => tx`insert into projects (id, workspace_id, name) values (${uuidv7()}, ${seed.b.id}, 'p') returning id`);
    await expect(withWorkspace(app, seed.a.id, async (tx) => {
      const n = await allocateIssueNumber(tx, teamA);
      await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by, project_id) values (${uuidv7()}, ${seed.a.id}, ${teamA}, ${n}, 't', 'a0', ${seed.a.member}, ${projB[0]!.id})`;
    })).rejects.toThrow(/foreign key/);
  });

  it("team key: 2-5 uppercase letters, unique per workspace", async () => {
    for (const bad of ["A", "abc", "ABCDEF", "AB1"]) {
      await expect(withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, bad)), bad).rejects.toThrow();
    }
    await expect(withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "ENG"))).rejects.toThrow(/teams_ws_key_uq/);
  });

  it("A2.1 100 concurrent issue creations in one team yield numbers 1..100, no gaps, no duplicates", async () => {
    const team = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "CON"));
    await Promise.all(Array.from({ length: 100 }, () => withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member))));
    const rows = await withWorkspace(app, seed.a.id, (tx) => tx`select number from issues where team_id = ${team} order by number`);
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it("a rolled-back creation does not consume a number; a deleted issue's number is not reused", async () => {
    const team = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "RBK"));
    await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member));
    await expect(withWorkspace(app, seed.a.id, async (tx) => { await mkIssue(tx, seed.a.id, team, seed.a.member); throw new Error("boom"); })).rejects.toThrow("boom");
    const id2 = await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member));
    await withWorkspace(app, seed.a.id, (tx) => tx`update issues set deleted_at = now() where id = ${id2}`);
    await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member));
    const rows = await withWorkspace(app, seed.a.id, (tx) => tx`select number from issues where team_id = ${team} order by number`);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it("A2.2 setting parent to itself or a descendant fails; depth capped at 5 including subtrees", async () => {
    const team = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "PAR"));
    const chain: string[] = [];
    await withWorkspace(app, seed.a.id, async (tx) => {
      for (let i = 0; i < 5; i++) chain.push(await mkIssue(tx, seed.a.id, team, seed.a.member, chain[i - 1] ?? null));
    });
    await expect(withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member, chain[4]!))).rejects.toThrow(/depth/); // 6th level
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`update issues set parent_id = ${chain[0]!} where id = ${chain[0]!}`)).rejects.toThrow(/cycle/);
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`update issues set parent_id = ${chain[3]!} where id = ${chain[1]!}`)).rejects.toThrow(/cycle/);
    // moving a root that has a 5-deep subtree under another issue would exceed depth 5
    const other = await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, team, seed.a.member));
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`update issues set parent_id = ${other} where id = ${chain[0]!}`)).rejects.toThrow(/depth/);
    // re-parenting within limits works
    await withWorkspace(app, seed.a.id, (tx) => tx`update issues set parent_id = null where id = ${chain[4]!}`);
  });

  it("cycles: overlap within a team rejected (inclusive bounds), adjacent and other teams allowed", async () => {
    const t1 = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "CY"));
    const t2 = await withWorkspace(app, seed.a.id, (tx) => mkTeam(tx, seed.a.id, "CZ"));
    const mk = (team: string, s: string, e: string) => withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${uuidv7()}, ${seed.a.id}, ${team}, 'c', ${s}, ${e})`);
    await mk(t1, "2026-11-01", "2026-11-14");
    await expect(mk(t1, "2026-11-14", "2026-11-20")).rejects.toThrow(/cycles_no_overlap/); // shares 14 Nov
    await expect(mk(t1, "2026-11-05", "2026-11-06")).rejects.toThrow(/cycles_no_overlap/);
    await mk(t1, "2026-11-15", "2026-11-28");
    await mk(t2, "2026-11-01", "2026-11-14");
    await expect(mk(t2, "2026-12-10", "2026-12-01")).rejects.toThrow(); // end before start
  });

  it("S5/2.7 audit_events is append-only for app_user; issues cannot be hard-deleted", async () => {
    const id = uuidv7();
    await withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff) values (${id}, ${seed.a.id}, ${seed.a.admin}, 'issue', ${uuidv7()}, 'create', ${tx.json({ title: { before: null, after: "t" } })})`);
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`update audit_events set action = 'x' where id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`delete from audit_events where id = ${id}`)).rejects.toThrow(/permission denied/);
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`delete from issues`)).rejects.toThrow(/permission denied/);
  });

  it("issue_labels and issue_shares reject cross-tenant references; shares are unique per (issue, guest)", async () => {
    const labelB = await withWorkspace(app, seed.b.id, (tx) => tx`insert into labels (id, workspace_id, name) values (${uuidv7()}, ${seed.b.id}, 'bug') returning id`);
    const issue = await withWorkspace(app, seed.a.id, (tx) => mkIssue(tx, seed.a.id, teamA, seed.a.member));
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into issue_labels (workspace_id, issue_id, label_id) values (${seed.a.id}, ${issue}, ${labelB[0]!.id})`)).rejects.toThrow(/foreign key/);
    const share = (tx: Tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${issue}, ${seed.a.guest}, ${seed.a.member})`;
    await withWorkspace(app, seed.a.id, share);
    await expect(withWorkspace(app, seed.a.id, share)).rejects.toThrow(/duplicate key/);
  });
});
