import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { db, getSessionUser } from "../../src/lib/http/ctx";
import { loadRemote } from "../../src/lib/remote";
import { installDevAuth } from "../../src/lib/dev-auth";
import { createIssue } from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("UI API path (ML_API=1 + ML_DEV_AUTH=1) against Postgres", () => {
  const owner = ownerSql(); let seed: Seed; const team = randomUUID();
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
    });
    process.env.ML_DEV_AUTH = "1"; process.env.ML_DEV_USER_ID = seed.a.member;
    installDevAuth();
    const r = await createIssue(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team_id: team, title: "wired" }) }), seed.a.slug);
    expect(r.status).toBe(201);
  });
  afterAll(async () => { delete process.env.ML_DEV_AUTH; await db().end(); await owner.end(); });

  it("loads issues through the M2 handlers as the dev user, tenant-scoped", async () => {
    const { issues } = await loadRemote({ slug: seed.a.slug, teamId: team });
    expect(issues.map((i) => i.title)).toContain("wired");
    expect(await getSessionUser(new Request("http://x"))).toBe(seed.a.member);
    await expect(loadRemote({ slug: seed.b.slug, teamId: team })).rejects.toThrow(/issues -> 40[34]/);
  });
});
