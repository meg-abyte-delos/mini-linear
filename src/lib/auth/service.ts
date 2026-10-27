import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { ApiError, errorResponse } from "../http/errors";
import { db } from "../http/ctx";
import { parseJson } from "../http/validate";
import { hashPassword, verifyPassword } from "./password";
import { hashToken, newToken } from "./tokens";
import { clientIp, hit } from "./ratelimit";
import { originAllowed } from "./origin";
import { clearCookieHeader, cookieHeader, createSession, destroyAllSessions, destroySession, resolveSession } from "./session";
import { sendMail } from "./mail";

const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const token = z.string().min(20).max(200);

type Handler = (req: Request, sql: postgres.Sql) => Promise<Response>;
/** Common wrapper: Origin check, then error mapping. */
export const route = (h: Handler) => async (req: Request, sql: postgres.Sql = db()): Promise<Response> => {
  try {
    if (!originAllowed(req)) throw new ApiError("forbidden", "cross-origin request refused");
    return await h(req, sql);
  } catch (e) { return errorResponse(e); }
};

const accepted = () => Response.json({ status: "accepted" }, { status: 202 });
const nameOf = (e: string) => e.split("@")[0]!; // users has no name column: derived from the address (assumption)

export const signup = route(async (req, sql) => {
  const body = await parseJson(req, z.object({ email, password }));
  await hit(sql, `signup:ip:${clientIp(req)}`, 10, 3600);
  const hash = await hashPassword(body.password); // always hash: same cost whether or not the address exists
  const id = randomUUID(), t = newToken();
  const created = await sql.begin(async (tx) => {
    const r = await tx`insert into users (id, email, password_hash) values (${id}, ${body.email}, ${hash}) on conflict do nothing returning id`;
    if (r.length === 0) return false;
    await tx`insert into email_verifications (id, user_id, token_hash, expires_at) values (${randomUUID()}, ${id}, ${hashToken(t)}, ${new Date(Date.now() + 86400_000)})`;
    return true;
  });
  if (created) await sendMail({ to: body.email, kind: "verify-email", token: t });
  return accepted(); // identical answer for duplicates: no account enumeration
});

export const verifyEmail = route(async (req, sql) => {
  const { token: t } = await parseJson(req, z.object({ token }));
  await sql.begin(async (tx) => {
    const r = await tx`update email_verifications set used_at = now() where token_hash = ${hashToken(t)} and used_at is null and expires_at > now() returning user_id`;
    if (r.length === 0) throw new ApiError("bad_request", "invalid or expired token");
    await tx`update users set email_verified_at = coalesce(email_verified_at, now()) where id = ${r[0]!.user_id}`;
  });
  return Response.json({ status: "verified" });
});

export const login = route(async (req, sql) => {
  const body = await parseJson(req, z.object({ email, password: z.string().min(1).max(128) }));
  await hit(sql, `login:ip:${clientIp(req)}`, 30, 60);
  await hit(sql, `login:email:${body.email}`, 10, 60);
  const u = (await sql<{ id: string; password_hash: string; locked_until: Date | null }[]>`select id, password_hash, locked_until from users where lower(email) = ${body.email}`)[0];
  const ok = await verifyPassword(u?.password_hash ?? null, body.password); // dummy hash when unknown
  const locked = !!u?.locked_until && u.locked_until.getTime() > Date.now();
  if (!u || locked || !ok) {
    if (u && !locked) {
      await sql`update users set
        locked_until = case when failed_logins + 1 >= ${MAX_FAILS}::int then ${new Date(Date.now() + LOCK_MS)}::timestamptz else locked_until end,
        failed_logins = case when failed_logins + 1 >= ${MAX_FAILS}::int then 0 else failed_logins + 1 end where id = ${u.id}`;
    }
    throw new ApiError("unauthenticated", "invalid credentials"); // same body for unknown, wrong password and locked
  }
  await sql`update users set failed_logins = 0, locked_until = null where id = ${u.id}`;
  const t = await createSession(sql, u.id);
  return Response.json({ status: "ok" }, { headers: { "set-cookie": cookieHeader(t) } });
});

export const logout = route(async (req, sql) => {
  await destroySession(sql, req);
  return new Response(null, { status: 204, headers: { "set-cookie": clearCookieHeader() } });
});

export const logoutAll = route(async (req, sql) => {
  const uid = await resolveSession(sql, req);
  if (!uid) throw new ApiError("unauthenticated");
  await destroyAllSessions(sql, uid);
  return new Response(null, { status: 204, headers: { "set-cookie": clearCookieHeader() } });
});

export const me = route(async (req, sql) => {
  const uid = await resolveSession(sql, req);
  if (!uid) throw new ApiError("unauthenticated");
  const u = (await sql<{ id: string; email: string }[]>`select id, email from users where id = ${uid}`)[0];
  if (!u) throw new ApiError("unauthenticated");
  return Response.json({ id: u.id, email: u.email, name: nameOf(u.email) });
});

export const passwordResetRequest = route(async (req, sql) => {
  const body = await parseJson(req, z.object({ email }));
  await hit(sql, `reset:ip:${clientIp(req)}`, 10, 3600);
  await hit(sql, `reset:email:${body.email}`, 3, 3600);
  const u = (await sql<{ id: string }[]>`select id from users where lower(email) = ${body.email}`)[0];
  if (u) {
    const t = newToken();
    await sql`insert into password_resets (id, user_id, token_hash, expires_at) values (${randomUUID()}, ${u.id}, ${hashToken(t)}, ${new Date(Date.now() + 3600_000)})`;
    await sendMail({ to: body.email, kind: "password-reset", token: t });
  }
  return accepted();
});

export const passwordResetConfirm = route(async (req, sql) => {
  const body = await parseJson(req, z.object({ token, password }));
  await hit(sql, `reset-confirm:ip:${clientIp(req)}`, 20, 3600);
  const hash = await hashPassword(body.password);
  await sql.begin(async (tx) => {
    const r = await tx`update password_resets set used_at = now() where token_hash = ${hashToken(body.token)} and used_at is null and expires_at > now() returning user_id`;
    if (r.length === 0) throw new ApiError("bad_request", "invalid or expired token");
    const uid = r[0]!.user_id as string;
    await tx`update password_resets set used_at = now() where user_id = ${uid} and used_at is null`; // invalidate sibling tokens
    await tx`update users set password_hash = ${hash}, failed_logins = 0, locked_until = null where id = ${uid}`;
    await destroyAllSessions(tx as unknown as postgres.Sql, uid);
  });
  return Response.json({ status: "ok" });
});
