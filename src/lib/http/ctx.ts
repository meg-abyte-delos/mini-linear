import postgres from "postgres";
import { ApiError, errorResponse, isDeadlock } from "./errors";
import { resolveSession } from "../auth/session";

export type Role = "owner" | "admin" | "member" | "guest";
export type Ctx = { tx: postgres.TransactionSql; userId: string; workspaceId: string; role: Role; req: Request };

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
    const userId = await getSessionUser(req);
    if (!userId) throw new ApiError("unauthenticated");
    // 40P01 (deadlock, e.g. two parent-trigger updates crossing) is transient: retry the whole tx once on a fresh
    // clone of the request (the body stream can only be read once), then surface it as 409 via errorResponse.
    const run = (r: Request) => sql.begin(async (tx) => {
      const rows = await tx<{ workspace_id: string; role: Role }[]>`select workspace_id, role from resolve_workspace(${slug}, ${userId})`;
      if (rows.length === 0) throw new ApiError("not_found");
      const { workspace_id, role } = rows[0]!;
      await tx`select set_config('app.workspace_id', ${workspace_id}, true)`;
      return fn({ tx, userId, workspaceId: workspace_id, role, req: r });
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
