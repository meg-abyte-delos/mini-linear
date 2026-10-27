import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { hashToken, newToken } from "./tokens";

export const COOKIE = "ml_session";
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 86400_000;

export const readCookie = (req: Request, name = COOKIE): string | null => {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};

export const cookieHeader = (token: string, maxAgeSec = TTL_DAYS * 86400) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
export const clearCookieHeader = () => cookieHeader("", 0);

export async function createSession(sql: postgres.Sql, userId: string): Promise<string> {
  const token = newToken();
  await sql`insert into sessions (id, user_id, token_hash, expires_at) values (${randomUUID()}, ${userId}, ${hashToken(token)}, ${new Date(Date.now() + TTL_MS)})`;
  return token;
}

/** Resolve the user of the request's session cookie; slides the 30-day expiry (written at most once a day). */
export async function resolveSession(sql: postgres.Sql, req: Request): Promise<string | null> {
  const token = readCookie(req);
  if (!token) return null;
  const rows = await sql<{ id: string; user_id: string; expires_at: Date }[]>`
    select id, user_id, expires_at from sessions where token_hash = ${hashToken(token)} and expires_at > now()`;
  const s = rows[0];
  if (!s) return null;
  if (s.expires_at.getTime() - Date.now() < TTL_MS - 86400_000) {
    await sql`update sessions set expires_at = ${new Date(Date.now() + TTL_MS)} where id = ${s.id}`;
  }
  return s.user_id;
}

export const destroySession = (sql: postgres.Sql, req: Request) => {
  const t = readCookie(req);
  return t ? sql`delete from sessions where token_hash = ${hashToken(t)}` : Promise.resolve();
};
export const destroyAllSessions = (sql: postgres.Sql, userId: string) => sql`delete from sessions where user_id = ${userId}`;
