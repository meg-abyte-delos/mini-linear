import postgres from "postgres";
import { ApiError, errorResponse, isDeadlock } from "./errors";
import { resolveSession } from "../auth/session";
import { originAllowed } from "../auth/origin";
import { hashToken } from "../auth/tokens";
import { hit, clientIp } from "../auth/ratelimit";
import { API_RATE_LIMIT, SAFE_METHODS, bearerApiKey } from "../integrations/apikey";

export type Role = "owner" | "admin" | "member" | "guest";
/** via: how the caller authenticated. API-key callers act with the key owner's CURRENT role, scoped to the key's workspace. */
export type Ctx = { tx: postgres.TransactionSql; userId: string; workspaceId: string; role: Role; req: Request; via?: "session" | "api_key"; apiKeyId?: string };

let _sql: postgres.Sql | undefined;
export const db = () => (_sql ??= postgres(process.env.DATABASE_URL ?? ""));

/**
 * Seam for M1 sessions: resolves the signed-in user id from the request cookie, or null. Default is the M1 cookie
 * session lookup; tests may override it with setSessionResolver.
 */
export type SessionResolver = (req: Request) => Promise<string | null>;
// Stored on globalThis: Next can load this module once per bundle (instrumentation vs route handlers),
// so a module-level variable set in instrumentation.ts would be invisible to routes (401 in dev).
const KEY = Symbol.for('mini-linear.sessionResolver');
type G = typeof globalThis & { [KEY]?: SessionResolver };
export const setSessionResolver = (r: SessionResolver) => { (globalThis as G)[KEY] = r; };
// Default: M1 cookie session lookup (overridable, e.g. by the dev stub or tests).
export const getSessionUser: SessionResolver = (req) => ((globalThis as G)[KEY] ?? ((r: Request) => resolveSession(db(), r)))(req);

const ORDER: Role[] = ["guest", "member", "admin", "owner"];
export const atLeast = (role: Role, min: Role) => ORDER.indexOf(role) >= ORDER.indexOf(min);
export function requireRole(ctx: Ctx, min: Role) { if (!atLeast(ctx.role, min)) throw new ApiError("forbidden"); }

/**
 * Run a workspace-scoped handler: authenticate, resolve the workspace from the slug via resolve_workspace(slug, user)
 * (non-member -> 404, never 403, so slugs are not enumerable), then run the handler in ONE transaction with
 * app.workspace_id set (RLS). Client-supplied workspace ids are never read. Any throw rolls the tx back.
 */
export async function withWorkspaceCtx(req: Request, slug: string, fn: (ctx: Ctx) => Promise<Response>, sql: postgres.Sql = db()): Promise<Response> {
  try {
    const key = await resolveApiKey(req, sql);
    // Bearer keys are not ambient credentials (no cookie), so the CSRF origin check applies to cookie auth only.
    if (!key && !originAllowed(req)) throw new ApiError("forbidden", "cross-origin request refused");
    const userId = key ? key.user_id : await getSessionUser(req);
    if (!userId) throw new ApiError("unauthenticated");
    // 40P01 (deadlock, e.g. two parent-trigger updates crossing) is transient: retry the whole tx once on a fresh
    // clone of the request (the body stream can only be read once), then surface it as 409 via errorResponse.
    const run = (r: Request) => sql.begin(async (tx) => {
      const rows = await tx<{ workspace_id: string; role: Role }[]>`select workspace_id, role from resolve_workspace(${slug}, ${userId})`;
      // A key only opens its own workspace (and only while its owner is still a member): else 404, like a non-member.
      if (rows.length === 0 || (key && rows[0]!.workspace_id !== key.workspace_id)) throw new ApiError("not_found");
      const { workspace_id } = rows[0]!;
      // read/write keys act as at most a member; only an admin-scope key (minted by an admin) keeps admin/owner powers.
      const role: Role = key && key.scope !== 'admin' && atLeast(rows[0]!.role, 'admin') ? 'member' : rows[0]!.role;
      await tx`select set_config('app.workspace_id', ${workspace_id}, true)`;
      // Session-derived user for the role RLS helpers (has_team_role / is_workspace_admin). Never client-supplied.
      await tx`select set_config('app.user_id', ${userId}, true)`;
      return fn({ tx, userId, workspaceId: workspace_id, role, req: r, via: key ? "api_key" : "session", apiKeyId: key?.key_id });
    });
    try {
      return (await run(req.clone())) as Response;
    } catch (e) {
      if (!isDeadlock(e)) throw e;
      return (await run(req)) as Response;
    }
  } catch (e) {
    return errorResponse(e);
  }
}

/** Authenticated, not workspace-scoped (workspace creation, listing, invite acceptance). Origin-checked, one tx, rolled back on throw. */
export async function withUser(req: Request, fn: (tx: postgres.TransactionSql, userId: string) => Promise<Response>, sql: postgres.Sql = db()): Promise<Response> {
  try {
    if (!originAllowed(req)) throw new ApiError("forbidden", "cross-origin request refused");
    const userId = await getSessionUser(req);
    if (!userId) throw new ApiError("unauthenticated");
    return (await sql.begin((tx) => fn(tx, userId))) as Response;
  } catch (e) {
    return errorResponse(e);
  }
}

const BAD_KEY_LIMIT = Number(process.env.API_BAD_KEY_LIMIT ?? 30);
type KeyRow = { key_id: string; workspace_id: string; user_id: string; scope: 'read' | 'write' | 'admin' };
/**
 * API-key auth (Authorization: Bearer mlk_...). undefined header -> null (fall back to the session cookie).
 * Malformed / unknown / revoked / expired -> 401. Read-only key on an unsafe method -> 403. Rate limited per key (429).
 */
export async function resolveApiKey(req: Request, sql: postgres.Sql = db()): Promise<KeyRow | null> {
  const tok = bearerApiKey(req);
  if (tok === undefined) return null;
  // Invalid credentials are rate limited per client IP (key guessing): 429 after BAD_KEY_LIMIT misses a minute.
  const bad = async () => { await hit(sql, `api:badkey:${clientIp(req)}`, BAD_KEY_LIMIT, 60); return new ApiError('unauthenticated', 'invalid API key'); };
  if (tok === null) throw await bad();
  const rows = await sql<KeyRow[]>`select key_id, workspace_id, user_id, scope from resolve_api_key(${hashToken(tok)})`;
  const k = rows[0];
  if (!k) throw await bad();
  await hit(sql, `api:key:${k.key_id}`, API_RATE_LIMIT.limit, API_RATE_LIMIT.windowSec);
  if (k.scope === "read" && !SAFE_METHODS.has(req.method)) throw new ApiError("forbidden", "read-only API key");
  return k;
}
/** Key management and webhook secrets are session-only: an API key can never mint keys or read/rotate webhooks. */
export function requireSession(ctx: Ctx) { if (ctx.via === "api_key") throw new ApiError("forbidden", "requires a signed-in session"); }
