import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appSql, ownerSql } from "../helpers/seed";
import { signup, login, logout, logoutAll, me, verifyEmail, passwordResetRequest, passwordResetConfirm } from "../../src/lib/auth/service";
import { setMailer, type Mail } from "../../src/lib/auth/mail";
import { hit } from "../../src/lib/auth/ratelimit";
import { originAllowed } from "../../src/lib/auth/origin";
import { resolveSession } from "../../src/lib/auth/session";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
const PW = "correct horse battery";
let n = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(++n / 250)}.${n % 250}`, ...headers }, body: JSON.stringify(body) });
const cookieOf = (r: Response) => /ml_session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];

(haveDb ? describe : describe.skip)("M1 auth", () => {
  const app = appSql(), owner = ownerSql(); const mails: Mail[] = [];
  const em = () => `u${Date.now()}${++n}@auth.test`;
  beforeAll(() => setMailer((m) => { mails.push(m); }));
  afterAll(async () => { await app.end(); await owner.end(); });
  const register = async (email = em()) => {
    expect((await signup(post({ email, password: PW }), app)).status).toBe(202);
    const t = mails.filter((m) => m.to === email.toLowerCase() && m.kind === "verify-email").at(-1)!.token;
    expect((await verifyEmail(post({ token: t }), app)).status).toBe(200);
    return email;
  };

  it("signup is non-enumerating, lowercases, verifies once", async () => {
    const email = await register(`MiXed${Date.now()}@auth.test`);
    const before = mails.length;
    expect((await signup(post({ email: email.toUpperCase(), password: PW }), app)).status).toBe(202);
    expect(mails.length).toBe(before);
    const t = mails.filter((m) => m.kind === "verify-email").at(-1)!.token;
    expect((await verifyEmail(post({ token: t }), app)).status).toBe(400);
    expect((await signup(post({ email: em(), password: "short" }), app)).status).toBe(422);
  });

  it("login -> /me -> logout; cookie flags; session dead after logout", async () => {
    const email = await register();
    const r = await login(post({ email, password: PW }), app);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly.*SameSite=Lax/);
    const c = `ml_session=${cookieOf(r)}`;
    const m = await me(new Request("http://x/api/v1/me", { headers: { cookie: c } }), app);
    expect(await m.json()).toMatchObject({ email, name: email.split("@")[0] });
    expect((await logout(post({}, { cookie: c }), app)).status).toBe(204);
    expect((await me(new Request("http://x/", { headers: { cookie: c } }), app)).status).toBe(401);
  });

  it("logout-all kills every session", async () => {
    const email = await register();
    const a = cookieOf(await login(post({ email, password: PW }), app)), b = cookieOf(await login(post({ email, password: PW }), app));
    expect((await logoutAll(post({}, { cookie: `ml_session=${a}` }), app)).status).toBe(204);
    expect(await resolveSession(app, new Request("http://x/", { headers: { cookie: `ml_session=${b}` } }))).toBeNull();
  });

  it("same 401 body for unknown, wrong password and locked; locks after 5 failures", async () => {
    const email = await register();
    const bodies = new Set<string>();
    for (const e of [em(), email]) bodies.add(await (await login(post({ email: e, password: "wrong-password-1" }), app)).text());
    for (let i = 0; i < 5; i++) expect((await login(post({ email, password: "wrong-password-1" }), app)).status).toBe(401);
    const locked = await login(post({ email, password: PW }), app);
    expect(locked.status).toBe(401);
    bodies.add(await locked.text());
    expect(bodies.size).toBe(1);
  });

  it("password reset: single use, revokes sessions, new password works", async () => {
    const email = await register();
    const c = cookieOf(await login(post({ email, password: PW }), app));
    expect((await passwordResetRequest(post({ email: em() }), app)).status).toBe(202);
    expect((await passwordResetRequest(post({ email }), app)).status).toBe(202);
    const t = mails.filter((m) => m.to === email && m.kind === "password-reset").at(-1)!.token;
    const np = "another long passphrase";
    expect((await passwordResetConfirm(post({ token: t, password: np }), app)).status).toBe(200);
    expect((await passwordResetConfirm(post({ token: t, password: np }), app)).status).toBe(400);
    expect(await resolveSession(app, new Request("http://x/", { headers: { cookie: `ml_session=${c}` } }))).toBeNull();
    expect((await login(post({ email, password: np }), app)).status).toBe(200);
  });

  it("rate limit is shared through Postgres across two connection pools (2 instances)", async () => {
    const other = appSql(); const key = `t:${Date.now()}`;
    for (let i = 0; i < 3; i++) await hit(i % 2 ? other : app, key, 5, 60);
    await hit(app, key, 5, 60); await hit(other, key, 5, 60);
    await expect(hit(app, key, 5, 60)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(hit(other, key, 5, 60)).rejects.toMatchObject({ code: "rate_limited" });
    await other.end();
  });

  // #32: timing check is noisy on shared CI runners; non-blocking, run with RUN_TIMING=1.
  it.runIf(process.env.RUN_TIMING === "1")("login median timing: unknown vs known email within tolerance", async () => {
    const email = await register();
    let n = 0;
    const once = async (e: string) => {
      const t0 = performance.now();
      await login(post({ email: e, password: "wrong-password-1" }, { "x-forwarded-for": `10.32.${(n >> 8) & 255}.${n++ & 255}` }), app);
      const dt = performance.now() - t0;
      if (e === email) await owner`update users set failed_logins = 0, locked_until = null where lower(email) = ${email}`;
      return dt;
    };
    for (let i = 0; i < 10; i++) { await once(email); await once(em()); }
    const k: number[] = [], u: number[] = [];
    for (let i = 0; i < 30; i++) {
      if (i % 2) { k.push(await once(email)); u.push(await once(em())); } else { u.push(await once(em())); k.push(await once(email)); }
    }
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return (s[14]! + s[15]!) / 2; };
    const mk = med(k), mu = med(u), tol = Math.max(25, 0.3 * Math.max(mk, mu));
    expect(Math.abs(mk - mu), `median known=${mk.toFixed(1)}ms unknown=${mu.toFixed(1)}ms tol=${tol.toFixed(1)}ms`).toBeLessThan(tol);
  }, 120_000);

  it("Origin check", () => {
    const r = (h: Record<string, string>, method = "POST") => new Request("http://app.test/api/v1/x", { method, headers: h });
    expect(originAllowed(r({ origin: "http://app.test", host: "app.test" }))).toBe(true);
    expect(originAllowed(r({ origin: "http://evil.test", host: "app.test" }))).toBe(false);
    expect(originAllowed(r({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(originAllowed(r({ origin: "http://evil.test", host: "app.test" }, "GET"))).toBe(true);
  });

  it("cross-origin login is refused with 403", async () => {
    expect((await login(post({ email: em(), password: PW }, { origin: "http://evil.test", host: "app.test" }), app)).status).toBe(403);
  });
});
