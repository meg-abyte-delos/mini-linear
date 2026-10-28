import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import { setMailer, type Mail } from "../../src/lib/auth/mail";
import * as T from "../../src/lib/resources/tenancy";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("M1 tenancy: workspaces, members, invites, teams", () => {
  const owner = ownerSql(); let seed: Seed; const mails: Mail[] = [];
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const go = (fn: unknown, user: string | null, method: string, body?: unknown, ...a: string[]) =>
    (fn as Fn)(new Request("http://x/api", { method, headers: { "x-u": user ?? "", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), ...a);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u") || null);
    setMailer((m) => { mails.push(m); });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("signup-style workspace creation: set tenant first, no RETURNING; creator is owner; listing and get are membership-scoped", async () => {
    const slug = `new-${randomUUID().slice(0, 8)}`;
    expect((await go(T.createWorkspace, null, "POST", { slug, name: "N" })).status).toBe(401);
    const r = await go(T.createWorkspace, seed.a.member, "POST", { slug, name: "N" });
    expect(r.status).toBe(201);
    expect((await go(T.createWorkspace, seed.a.member, "POST", { slug, name: "dup" })).status).toBe(409);
    expect((await go(T.createWorkspace, seed.a.member, "POST", { slug: "X", name: "bad" })).status).toBe(422);
    const list = await (await go(T.listWorkspaces, seed.a.member, "GET")).json();
    expect(list.items.map((w: { slug: string }) => w.slug).sort()).toEqual([seed.a.slug, slug].sort());
    expect((await go(T.getWorkspace, seed.a.member, "GET", undefined, slug)).status).toBe(200);
    const me = await (await go(T.getWorkspace, seed.a.member, "GET", undefined, slug)).json(); // session user id for author-only UI actions
    expect(me.user_id).toBe(seed.a.member);
    expect((await go(T.getWorkspace, seed.b.member, "GET", undefined, slug)).status).toBe(404);
  });

  it("members: list is tenant-scoped; role rules; last owner protected; non-member 404", async () => {
    const s = seed.a.slug;
    expect((await go(T.listMembers, seed.a.guest, "GET", undefined, s)).status).toBe(403);
    const ok = await (await go(T.listMembers, seed.a.member, "GET", undefined, s)).json();
    expect(ok.items).toHaveLength(4);
    expect((await go(T.listMembers, seed.b.owner, "GET", undefined, s)).status).toBe(404);
    expect((await go(T.patchMember, seed.a.member, "PATCH", { role: "admin" }, s, seed.a.guest)).status).toBe(403);
    expect((await go(T.patchMember, seed.a.admin, "PATCH", { role: "admin" }, s, seed.a.guest)).status).toBe(403); // admins cannot mint admins
    expect((await go(T.patchMember, seed.a.admin, "PATCH", { role: "member" }, s, seed.a.owner)).status).toBe(403);
    expect((await go(T.patchMember, seed.a.admin, "PATCH", { role: "member" }, s, seed.a.guest)).status).toBe(200);
    expect((await go(T.patchMember, seed.a.owner, "PATCH", { role: "member" }, s, seed.a.owner)).status).toBe(409); // last owner
    expect((await go(T.deleteMember, seed.a.owner, "DELETE", undefined, s, seed.a.owner)).status).toBe(409);
    expect((await go(T.patchMember, seed.a.owner, "PATCH", { role: "guest" }, s, seed.a.guest)).status).toBe(200);
    expect((await go(T.deleteMember, seed.a.admin, "DELETE", undefined, s, seed.a.guest)).status).toBe(204);
    expect((await go(T.deleteMember, seed.a.member, "DELETE", undefined, s, seed.a.member)).status).toBe(204); // leave
  });

  it("invites: lowercase email, token only by mail, accept needs matching verified user, single use, cross-tenant isolation", async () => {
    const s = seed.b.slug, addr = `Newbie${randomUUID().slice(0, 6)}@Example.com`;
    expect((await go(T.createInvite, seed.b.member, "POST", { email: addr, role: "member" }, s)).status).toBe(403);
    expect((await go(T.createInvite, seed.b.admin, "POST", { email: addr, role: "admin" }, s)).status).toBe(403);
    expect((await go(T.createInvite, seed.a.owner, "POST", { email: addr, role: "member" }, s)).status).toBe(404);
    const c = await go(T.createInvite, seed.b.admin, "POST", { email: addr, role: "member" }, s);
    expect(c.status).toBe(201);
    const body = await c.json(); expect(body.email).toBe(addr.toLowerCase()); expect(JSON.stringify(body)).not.toMatch(/token/);
    const tok = mails.filter((m) => m.kind === "invite").at(-1)!.token;
    const stored = await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.b.id}, true)`; return tx`select email from invites where id = ${body.id}`; });
    expect(stored[0]!.email).toBe(addr.toLowerCase());
    expect((await (await go(T.listInvites, seed.b.admin, "GET", undefined, s)).json()).items.some((i: { id: string }) => i.id === body.id)).toBe(true);
    // user with matching email (stored mixed-case-insensitively) and a verified address
    const uid = randomUUID(), other = randomUUID();
    await owner`insert into users (id, email, password_hash, email_verified_at) values (${uid}, ${addr}, 'x', now()), (${other}, ${`o${other}@x.test`}, 'x', now())`;
    expect((await go(T.acceptInvite, other, "POST", { token: tok })).status).toBe(404); // wrong user
    expect((await go(T.acceptInvite, uid, "POST", { token: "x".repeat(30) })).status).toBe(404);
    const a = await go(T.acceptInvite, uid, "POST", { token: tok });
    expect(a.status).toBe(200); expect((await a.json()).slug).toBe(s);
    expect((await go(T.acceptInvite, uid, "POST", { token: tok })).status).toBe(404); // single use
    expect((await go(T.getWorkspace, uid, "GET", undefined, s)).status).toBe(200);
    expect((await go(T.getWorkspace, uid, "GET", undefined, seed.a.slug)).status).toBe(404);
    const c2 = await go(T.createInvite, seed.b.admin, "POST", { email: `z${other}@x.test`, role: "guest" }, s);
    expect((await go(T.deleteInvite, seed.b.admin, "DELETE", undefined, s, (await c2.json()).id)).status).toBe(204);
  });

  it("teams: CRUD admin-only writes, key immutable/validated, team members must be workspace members", async () => {
    const s = seed.b.slug;
    expect((await go(T.createTeam, seed.b.member, "POST", { name: "T", key: "TEA" }, s)).status).toBe(403);
    expect((await go(T.createTeam, seed.b.admin, "POST", { name: "T", key: "tea" }, s)).status).toBe(422);
    const t = await go(T.createTeam, seed.b.admin, "POST", { name: "Team", key: "TEA" }, s);
    expect(t.status).toBe(201); const id = (await t.json()).id;
    expect((await go(T.createTeam, seed.b.admin, "POST", { name: "Dup", key: "TEA" }, s)).status).toBe(409);
    expect((await go(T.patchTeam, seed.b.admin, "PATCH", { name: "Renamed", key: "NEW" }, s, id)).status).toBe(422); // strict: key immutable
    expect((await go(T.patchTeam, seed.b.admin, "PATCH", { name: "Renamed" }, s, id)).status).toBe(200);
    expect((await go(T.getWorkspace, seed.a.admin, "GET", undefined, s)).status).toBe(404);
    expect((await go(T.listTeams, seed.a.admin, "GET", undefined, s)).status).toBe(404);
    expect((await go(T.addTeamMember, seed.b.admin, "POST", undefined, s, id, seed.a.member)).status).toBe(404); // other tenant's user
    expect((await go(T.addTeamMember, seed.b.admin, "POST", undefined, s, id, seed.b.member)).status).toBe(201);
    expect((await go(T.addTeamMember, seed.b.admin, "POST", undefined, s, id, seed.b.member)).status).toBe(200);
    expect((await (await go(T.listTeamMembers, seed.b.member, "GET", undefined, s, id)).json()).items).toHaveLength(1);
    expect((await go(T.removeTeamMember, seed.b.admin, "DELETE", undefined, s, id, seed.b.member)).status).toBe(204);
    expect((await go(T.deleteTeam, seed.b.admin, "DELETE", undefined, s, id)).status).toBe(204);
    expect((await go(T.listTeams, seed.a.owner, "GET", undefined, seed.a.slug)).status).toBe(200);
  });

  it("Origin check applies to workspace-scoped writes", async () => {
    const r = new Request("http://x/api", { method: "POST", headers: { "x-u": seed.b.admin, origin: "http://evil.test", "content-type": "application/json" }, body: JSON.stringify({ name: "T", key: "EVL" }) });
    expect((await T.createTeam(r, seed.b.slug)).status).toBe(403);
  });
});
