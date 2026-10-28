import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { type Row, audit, teamVisible } from "./common";
import { decodeCursor, page } from "../http/cursor";

const body = z.object({ guest_user_id: uuidSchema }).strict();
const SHARE = (ctx: Ctx, issueId: string) => ctx.tx<Row[]>`select issue_id, guest_user_id, shared_by, created_at from issue_shares where issue_id = ${issueId} and revoked_at is null order by guest_user_id`;
async function liveIssue(ctx: Ctx, id: string) {
  const r = await ctx.tx`select i.id from issues i where i.id = ${id} and i.deleted_at is null and ${teamVisible(ctx, "i.team_id")}`;
  if (r.length === 0) throw new ApiError("not_found");
}

/** Share an issue with a workspace guest. Admin/member only; re-sharing after a revoke reactivates the row. */
export const shareIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), b = await parseJson(req, body);
  await liveIssue(ctx, id);
  const m = await ctx.tx<{ role: string }[]>`select role from memberships where user_id = ${b.guest_user_id}`;
  if (m.length === 0 || m[0]!.role !== "guest") throw new ApiError("validation_failed", "target must be a guest member of this workspace");
  const prev = await ctx.tx<Row[]>`select revoked_at from issue_shares where issue_id = ${id} and guest_user_id = ${b.guest_user_id}`;
  if (prev[0] && prev[0].revoked_at === null) return Response.json({ issue_id: id, guest_user_id: b.guest_user_id, already_shared: true }, { status: 200 });
  await ctx.tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${ctx.workspaceId}, ${id}, ${b.guest_user_id}, ${ctx.userId})
    on conflict (issue_id, guest_user_id) do update set revoked_at = null, shared_by = ${ctx.userId}, created_at = now()`;
  await audit(ctx, "issue_share", id, "create", { guest_user_id: { before: null, after: b.guest_user_id } });
  return Response.json({ issue_id: id, guest_user_id: b.guest_user_id }, { status: 201 });
});

/** Revoke a share: DELETE .../issues/{id}/shares/{guest_user_id}. 204 whether or not it was active (idempotent), 404 if the issue is unknown. */
export const unshareIssue = (req: Request, slug: string, rawId: string, rawGuest: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), q = { guest_user_id: parseId(rawGuest) };
  await liveIssue(ctx, id);
  const u = await ctx.tx`update issue_shares set revoked_at = now() where issue_id = ${id} and guest_user_id = ${q.guest_user_id} and revoked_at is null returning guest_user_id`;
  if (u.length) await audit(ctx, "issue_share", id, "delete", { guest_user_id: { before: q.guest_user_id, after: null } });
  return new Response(null, { status: 204 });
});

export const listShares = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId);
  await liveIssue(ctx, id);
  return Response.json({ items: await SHARE(ctx, id), next_cursor: null });
});

/** Audit log, admin+, newest first. Keyset = (created_at desc, id desc), matching audit_events_list_idx. Filters: entity, entity_id. */
export const listAudit = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const q = parseQuery(req, listQuery.extend({ entity: z.string().min(1).max(64).optional(), entity_id: uuidSchema.optional() }));
  const c = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, "audit") : null, t = ctx.tx;
  // created_at::text keeps microsecond precision for the cursor; ::text::timestamptz stops postgres.js from round-tripping it through a JS Date (ms), which would skip or repeat rows.
  const rows = await t<Row[]>`select id, actor_id, entity, entity_id, action, diff, created_at, created_at::text as _k from audit_events
    where ${c ? t`(created_at, id) < (${c.k}::text::timestamptz, ${c.id}::uuid)` : t`true`} ${q.entity ? t`and entity = ${q.entity}` : t``} ${q.entity_id ? t`and entity_id = ${q.entity_id}` : t``}
    order by created_at desc, id desc limit ${q.limit + 1}`;
  const p = page(rows, q.limit, ctx.workspaceId, "audit", (r) => ({ k: r._k as string, id: r.id as string }));
  return Response.json({ items: p.items.map((r) => { const o = { ...r }; delete o._k; return o; }), next_cursor: p.next_cursor });
});
