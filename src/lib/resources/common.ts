import { type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { recordAudit, type Diff } from "../audit";

export type Row = Record<string, unknown>;
export const stale = (r: Row) => new ApiError("precondition_failed", "stale version", { current_version: r.version });
export const out = (r: Row, status = 200) => Response.json(r, { status, headers: { ETag: `"${r.version}"` } });
export const audit = (ctx: Ctx, entity: string, id: string, action: string, diff: Diff) =>
  recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity, entityId: id, action, diff });
/** Lists are ordered by id (uuidv7 = creation order); the cursor carries the last id. */
export function listPage(ctx: Ctx, scope: string, q: { limit: number }, rows: Row[]) {
  const p = page(rows, q.limit, ctx.workspaceId, scope, (r) => ({ k: r.id as string, id: r.id as string }));
  return Response.json({ items: p.items, next_cursor: p.next_cursor });
}
export const afterId = (ctx: Ctx, scope: string, q: { cursor?: string }) => (q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, scope).id : null);
