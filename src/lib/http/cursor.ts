import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors";

/**
 * Opaque keyset cursors, HMAC-signed so clients cannot forge positions. Bound to the workspace and a list scope
 * (e.g. "issues:created_at:desc") so a cursor from one tenant/list is rejected elsewhere.
 */
export type CursorPos = { k: string; id: string }; // k = sort value (string-encoded), id = tiebreaker
const secret = () => {
  const s = process.env.CURSOR_SECRET ?? process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("CURSOR_SECRET missing");
    return "dev-only-cursor-secret";
  }
  return s;
};
const mac = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export function encodeCursor(workspaceId: string, scope: string, pos: CursorPos): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, s: scope, k: pos.k, id: pos.id })).toString("base64url");
  return `${body}.${mac(body)}`;
}

export function decodeCursor(token: string, workspaceId: string, scope: string): CursorPos {
  const bad = () => new ApiError("bad_request", "invalid cursor");
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) throw bad();
  const want = Buffer.from(mac(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw bad();
  let p: { w?: string; s?: string; k?: string; id?: string };
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw bad(); }
  if (p.w !== workspaceId || p.s !== scope || typeof p.k !== "string" || typeof p.id !== "string") throw bad();
  return { k: p.k, id: p.id };
}

/** Build { items, next_cursor } from rows fetched with limit+1. */
export function page<T>(rows: T[], limit: number, workspaceId: string, scope: string, pos: (r: T) => CursorPos): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, next_cursor: rows.length > limit ? encodeCursor(workspaceId, scope, pos(items[items.length - 1]!)) : null };
}
