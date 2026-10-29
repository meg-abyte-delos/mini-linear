import { describe, it, expect, vi, beforeEach } from "vitest";
import { originAllowed } from "../../src/lib/auth/origin";
import { hashPassword, verifyPassword } from "../../src/lib/auth/password";
import { hashToken } from "../../src/lib/auth/tokens";
import { readCookie, cookieHeader, clearCookieHeader, COOKIE, createSession, resolveSession, destroySession, destroyAllSessions } from "../../src/lib/auth/session";
import { atLeast, requireRole, setSessionResolver, withUser, withWorkspaceCtx, type Ctx } from "../../src/lib/http/ctx";
import { ApiError } from "../../src/lib/http/errors";

const U = "http://app.test/api/x";
const req = (method: string, h: Record<string, string> = {}) => new Request(U, { method, headers: h });

describe("originAllowed (CSRF)", () => {
  it("safe methods always pass", () => { for (const m of ["GET", "HEAD", "OPTIONS"]) expect(originAllowed(req(m, { origin: "https://evil.test" }))).toBe(true); });
  it("same-origin Origin passes, foreign/garbage Origin refused", () => {
    expect(originAllowed(req("POST", { origin: "http://app.test" }))).toBe(true);
    expect(originAllowed(req("POST", { origin: "https://evil.test" }))).toBe(false);
    expect(originAllowed(req("DELETE", { origin: "null" }))).toBe(false);
  });
  it("x-forwarded-host wins over URL host", () => {
    expect(originAllowed(req("PATCH", { "x-forwarded-host": "pub.test", origin: "https://pub.test" }))).toBe(true);
    expect(originAllowed(req("PATCH", { "x-forwarded-host": "pub.test", origin: "http://app.test" }))).toBe(false);
  });
  it("x-forwarded-host set: Host is ignored, a Host/XFH mismatch is decided by XFH only", () => {
    expect(originAllowed(req("POST", { host: "internal.test", "x-forwarded-host": "pub.test", origin: "https://pub.test" }))).toBe(true);
    expect(originAllowed(req("POST", { host: "pub.test", "x-forwarded-host": "internal.test", origin: "https://pub.test" }))).toBe(false);
    expect(originAllowed(req("POST", { host: "app.test", origin: "https://app.test" }))).toBe(true); // no XFH: Host is used
  });
  it("multi-valued x-forwarded-host fails closed", () => {
    expect(originAllowed(req("POST", { "x-forwarded-host": "pub.test, proxy.test", origin: "https://pub.test" }))).toBe(false);
  });
  it("no Origin: Sec-Fetch-Site decides", () => {
    expect(originAllowed(req("PUT"))).toBe(true);
    expect(originAllowed(req("PUT", { "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(originAllowed(req("PUT", { "sec-fetch-site": "none" }))).toBe(true);
    expect(originAllowed(req("PUT", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(originAllowed(req("PUT", { "sec-fetch-site": "same-site" }))).toBe(false);
  });
});

describe("password (argon2id)", () => {
  it("verifies the right password only, unknown user always false, garbage hash false", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword(null, "dummy-password-for-timing")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  }, 20000);
});

// Minimal tagged-template fake for postgres.Sql: records queries, returns queued rows.
function fakeSql(results: unknown[][] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fake of postgres tagged template
  const sql = ((s: TemplateStringsArray, ...values: unknown[]) => { calls.push({ text: s.join("?"), values }); return Promise.resolve(results.shift() ?? []); }) as any;
  sql.begin = (fn: (tx: unknown) => unknown) => fn(sql);
  return { sql, calls };
}

describe("session cookie + store", () => {
  it("readCookie parses, decodes, ignores look-alikes and bad encoding", () => {
    expect(readCookie(req("GET", { cookie: `a=1; ${COOKIE}=t%2Bk ; x${COOKIE}=no` }))).toBe("t+k");
    expect(readCookie(req("GET", { cookie: `${COOKIE}x=1` }))).toBeNull();
    expect(readCookie(req("GET", { cookie: `${COOKIE}=%E0%A4%A` }))).toBeNull();
    expect(readCookie(req("GET"))).toBeNull();
  });
  it("cookie is HttpOnly SameSite=Lax, clear sets Max-Age=0", () => {
    expect(cookieHeader("t")).toMatch(/HttpOnly; SameSite=Lax; Max-Age=2592000/);
    expect(clearCookieHeader()).toMatch(/^ml_session=; .*Max-Age=0/);
  });
  it("createSession stores only the token hash", async () => {
    const { sql, calls } = fakeSql();
    const t = await createSession(sql, "u1");
    expect(calls[0]!.values).toContain(hashToken(t));
    expect(calls[0]!.values).not.toContain(t);
  });
  it("resolveSession: no cookie / unknown token -> null; fresh session not rewritten; old one slid", async () => {
    expect(await resolveSession(fakeSql().sql, req("GET"))).toBeNull();
    expect(await resolveSession(fakeSql([[]]).sql, req("GET", { cookie: `${COOKIE}=t` }))).toBeNull();
    const fresh = fakeSql([[{ id: "s", user_id: "u", expires_at: new Date(Date.now() + 30 * 86400_000) }]]);
    expect(await resolveSession(fresh.sql, req("GET", { cookie: `${COOKIE}=t` }))).toBe("u");
    expect(fresh.calls).toHaveLength(1);
    const old = fakeSql([[{ id: "s", user_id: "u", expires_at: new Date(Date.now() + 2 * 86400_000) }], []]);
    expect(await resolveSession(old.sql, req("GET", { cookie: `${COOKIE}=t` }))).toBe("u");
    expect(old.calls[1]!.text).toMatch(/update sessions/);
    expect(old.calls[0]!.values).toContain(hashToken("t"));
  });
  it("destroySession is a no-op without cookie; destroyAll targets the user", async () => {
    const a = fakeSql(); await destroySession(a.sql, req("POST")); expect(a.calls).toHaveLength(0);
    const b = fakeSql(); await destroySession(b.sql, req("POST", { cookie: `${COOKIE}=t` })); expect(b.calls[0]!.values).toEqual([hashToken("t")]);
    const c = fakeSql(); await destroyAllSessions(c.sql, "u9"); expect(c.calls[0]!.values).toEqual(["u9"]);
  });
});

describe("ctx: roles, auth and workspace scoping", () => {
  beforeEach(() => setSessionResolver(async () => "user-1"));
  it("role ordering", () => {
    expect(atLeast("owner", "admin")).toBe(true);
    expect(atLeast("member", "admin")).toBe(false);
    expect(atLeast("guest", "guest")).toBe(true);
    expect(() => requireRole({ role: "member" } as Ctx, "admin")).toThrow(ApiError);
    expect(() => requireRole({ role: "admin" } as Ctx, "admin")).not.toThrow();
  });
  it("cross-origin write -> 403 before auth", async () => {
    const resolver = vi.fn(async () => "u"); setSessionResolver(resolver);
    const r = await withUser(req("POST", { origin: "https://evil.test" }), async () => new Response("ok"), fakeSql().sql);
    expect(r.status).toBe(403); expect(resolver).not.toHaveBeenCalled();
  });
  it("no session -> 401 (withUser and withWorkspaceCtx)", async () => {
    setSessionResolver(async () => null);
    expect((await withUser(req("GET"), async () => new Response("ok"), fakeSql().sql)).status).toBe(401);
    expect((await withWorkspaceCtx(req("GET"), "w1", async () => new Response("ok"), fakeSql().sql)).status).toBe(401);
  });
  it("non-member slug -> 404, never 403 (no enumeration)", async () => {
    const fn = vi.fn();
    const r = await withWorkspaceCtx(req("GET"), "secret", fn, fakeSql([[]]).sql);
    expect(r.status).toBe(404); expect(fn).not.toHaveBeenCalled();
  });
  it("member: sets app.workspace_id from the server-resolved id and passes role", async () => {
    const { sql, calls } = fakeSql([[{ workspace_id: "ws-9", role: "member" }], [], []]);
    let seen: Ctx | undefined;
    const r = await withWorkspaceCtx(req("GET"), "w1", async (c) => { seen = c; return new Response("ok"); }, sql);
    expect(r.status).toBe(200);
    expect(calls[0]!.values).toEqual(["w1", "user-1"]);
    expect(calls[1]!.text).toMatch(/set_config\('app.workspace_id'/);
    expect(calls[1]!.values).toEqual(["ws-9"]);
    expect(seen).toMatchObject({ userId: "user-1", workspaceId: "ws-9", role: "member" });
  });
  it("handler ApiError maps to its status; deadlock retried once", async () => {
    const r = await withWorkspaceCtx(req("GET"), "w1", async (c) => { requireRole(c, "admin"); return new Response("ok"); }, fakeSql([[{ workspace_id: "w", role: "guest" }], [], []]).sql);
    expect(r.status).toBe(403);
    let n = 0;
    const r2 = await withWorkspaceCtx(req("GET"), "w1", async () => { if (n++ === 0) throw Object.assign(new Error("dl"), { code: "40P01" }); return new Response("ok"); },
      fakeSql([[{ workspace_id: "w", role: "owner" }], [], [], [{ workspace_id: "w", role: "owner" }], [], []]).sql);
    expect(r2.status).toBe(200); expect(n).toBe(2);
  });
});
