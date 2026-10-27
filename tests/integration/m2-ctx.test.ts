import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { withWorkspaceCtx, setSessionResolver, requireRole } from "../../src/lib/http/ctx";
import { recordAudit } from "../../src/lib/audit";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("withWorkspaceCtx", () => {
  const app = appSql(), owner = ownerSql(); let seed: Seed;
  const req = (u?: string) => new Request("http://x/", { headers: u ? { "x-u": u } : {} });
  beforeAll(async () => { seed = await seedTwoWorkspaces(owner); setSessionResolver(async (r) => r.headers.get("x-u")); });
  afterAll(async () => { await app.end(); await owner.end(); });

  it("401 without a session", async () => {
    expect((await withWorkspaceCtx(req(), seed.a.slug, async () => Response.json({}), app)).status).toBe(401);
  });
  it("404 for a non-member and for an unknown slug (no enumeration)", async () => {
    expect((await withWorkspaceCtx(req(seed.b.owner), seed.a.slug, async () => Response.json({}), app)).status).toBe(404);
    expect((await withWorkspaceCtx(req(seed.a.owner), "nope", async () => Response.json({}), app)).status).toBe(404);
  });
  it("sets tenant + role from membership; handler errors map to status", async () => {
    const res = await withWorkspaceCtx(req(seed.a.guest), seed.a.slug, async (c) => { requireRole(c, "member"); return Response.json({}); }, app);
    expect(res.status).toBe(403);
    const ok = await withWorkspaceCtx(req(seed.a.admin), seed.a.slug, async (c) => {
      const w = (await c.tx`select current_setting('app.workspace_id') as w`)[0]!.w;
      return Response.json({ w, role: c.role });
    }, app);
    expect(await ok.json()).toEqual({ w: seed.a.id, role: "admin" });
  });
  it("audit rows commit with the tx and roll back with it", async () => {
    await withWorkspaceCtx(req(seed.a.admin), seed.a.slug, async (c) => {
      await recordAudit(c.tx, { workspaceId: c.workspaceId, actorId: c.userId, entity: "label", entityId: null, action: "create", diff: { name: { before: null, after: "x" }, password_hash: { before: 1, after: 2 } } });
      return Response.json({});
    }, app);
    const bad = await withWorkspaceCtx(req(seed.a.admin), seed.a.slug, async (c) => {
      await recordAudit(c.tx, { workspaceId: c.workspaceId, actorId: c.userId, entity: "label", entityId: null, action: "rolledback" });
      throw new Error("boom");
    }, app);
    expect(bad.status).toBe(500);
    const rows = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return tx`select action, diff from audit_events`; });
    expect(rows.map((r) => r.action)).toEqual(["create"]);
    expect(JSON.stringify(rows[0]!.diff)).not.toContain("password");
  });
});
