import postgres from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DATABASE_URL / DATABASE_OWNER_URL are unset: integration tests must not skip");
const run = haveDb ? describe : describe.skip;
run("M1 RLS", () => {
  const app = appSql(), owner = ownerSql();
  let seed: Seed;
  beforeAll(async () => { seed = await seedTwoWorkspaces(owner); });
  afterAll(async () => { await app.end(); await owner.end(); });

  it("A1.2 unset app.workspace_id returns 0 rows on tenant tables", async () => {
    for (const t of ["memberships", "teams", "team_memberships", "invites"]) {
      const rows = await withWorkspace(app, null, (tx) => tx.unsafe(`select 1 from ${t}`));
      expect(rows.length).toBe(0);
    }
  });
  it("A1.1 workspace A context never sees workspace B rows", async () => {
    const rows = await withWorkspace(app, seed.a.id, (tx) => tx`select workspace_id from memberships`);
    expect(rows.length).toBe(4);
    expect(rows.every((r) => r.workspace_id === seed.a.id)).toBe(true);
  });
  it("WITH CHECK blocks inserting into another workspace", async () => {
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into teams (id, workspace_id, name) values (gen_random_uuid(), ${seed.b.id}, 'x')`)).rejects.toThrow();
  });
  it("resolve_workspace returns the workspace only for members", async () => {
    const ok = await app`select * from resolve_workspace(${seed.a.slug}, ${seed.a.member})`;
    const no = await app`select * from resolve_workspace(${seed.a.slug}, ${seed.b.member})`;
    expect(ok.length).toBe(1);
    expect(no.length).toBe(0);
  });
  it("lookup_invite works under FORCE RLS (definer bypass) and returns only the 4 agreed columns", async () => {
    const hash = "h-" + seed.a.id;
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) values (gen_random_uuid(), ${seed.a.id}, 'x@y.test', 'member', ${hash}, ${seed.a.admin}, now() + interval '1 day')`;
    });
    const r = await app`select * from lookup_invite(${hash})`;
    expect(r.length).toBe(1);
    expect(Object.keys(r[0]!).sort()).toEqual(["email", "invite_id", "role", "workspace_id"]);
  });
  it("workspaces: app_user cannot read it directly, and INSERT is tenant-checked", async () => {
    await expect(withWorkspace(app, seed.a.id, (tx) => tx`select 1 from workspaces`)).rejects.toThrow(/permission denied/i);
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into workspaces (id, slug, name) values (${crypto.randomUUID()}, 'evil', 'evil')`)).rejects.toThrow(/row-level security/i);
    const id = crypto.randomUUID();
    await withWorkspace(app, id, (tx) => tx`insert into workspaces (id, slug, name) values (${id}, ${"ok-" + id.slice(0, 8)}, 'ok')`);
  });
  it("T1 cross-tenant reference: team_memberships cannot point at a team of another workspace", async () => {
    const team = crypto.randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.b.id}, true)`;
      await tx`insert into teams (id, workspace_id, name) values (${team}, ${seed.b.id}, 't')`;
    });
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${seed.a.member})`)).rejects.toThrow(/foreign key/i);
  });
  it("WITH CHECK also blocks UPDATE moving a row to another workspace", async () => {
    await expect(withWorkspace(app, seed.a.id, (tx) =>
      tx`update memberships set workspace_id = ${seed.b.id} where user_id = ${seed.a.member}`)).rejects.toThrow();
  });
  it("pooled connection: a tenant set in one tx does not leak into the next", async () => {
    const one = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      await withWorkspace(one, seed.a.id, (tx) => tx`select 1`);
      expect((await withWorkspace(one, null, (tx) => tx`select 1 from memberships`)).length).toBe(0);
    } finally { await one.end(); }
  });
});
