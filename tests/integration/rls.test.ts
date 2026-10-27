import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from "../helpers/seed";

const run = process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL ? describe : describe.skip;
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
});
