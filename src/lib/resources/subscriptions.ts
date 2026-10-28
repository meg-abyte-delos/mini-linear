import { withWorkspaceCtx, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId } from "../http/validate";
import { teamVisible } from "./common";

export type SubReason = "creator" | "assignee" | "mention" | "commenter" | "manual";
/**
 * Idempotent auto-subscribe (first reason wins). Guests are never auto-subscribed. Runs under RLS.
 * `on conflict do nothing` keeps a muted row muted: someone who unsubscribed (muted = true) is not re-added.
 */
export async function subscribe(ctx: Ctx, issueId: string, userIds: (string | null | undefined)[], reason: SubReason) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (!ids.length) return;
  await ctx.tx`insert into issue_subscribers (workspace_id, issue_id, user_id, reason)
    select ${ctx.workspaceId}, ${issueId}, m.user_id, ${reason} from memberships m where m.user_id in ${ctx.tx(ids)} and m.role <> 'guest'
    on conflict (issue_id, user_id) do nothing`;
}

/** Same visibility as the issue itself (guests: active share; members: their teams; admin+: all). Else 404. */
async function issueVisible(ctx: Ctx, issueId: string) {
  const t = ctx.tx;
  const r = await t`select 1 from issues i where i.id = ${issueId} and i.deleted_at is null and ${ctx.role === "guest"
    ? t`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)` : teamVisible(ctx, "i.team_id")}`;
  if (!r.length) throw new ApiError("not_found");
}
/** subscribed = has a row and is not muted. `source` is the row's reason ('manual' or the auto reason). */
const state = async (ctx: Ctx, issueId: string) => {
  const r = await ctx.tx<{ reason: string; muted: boolean }[]>`select reason, muted from issue_subscribers where issue_id = ${issueId} and user_id = ${ctx.userId}`;
  const on = !!r[0] && !r[0].muted;
  return Response.json({ subscribed: on, source: on ? (r[0]!.reason === "manual" ? "manual" : "auto") : null });
};

export const getSubscription = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await issueVisible(ctx, id); return state(ctx, id);
});
/** Manual subscribe (idempotent, also lifts a mute). Guests may subscribe to issues shared with them. */
export const putSubscription = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await issueVisible(ctx, id);
  await ctx.tx`insert into issue_subscribers (workspace_id, issue_id, user_id, reason) values (${ctx.workspaceId}, ${id}, ${ctx.userId}, 'manual')
    on conflict (issue_id, user_id) do update set reason = 'manual', muted = false`;
  return state(ctx, id);
});
/** Unsubscribe = tombstone (muted = true), so auto-subscribe does not bring the user back. Idempotent. */
export const deleteSubscription = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await issueVisible(ctx, id);
  await ctx.tx`insert into issue_subscribers (workspace_id, issue_id, user_id, reason, muted) values (${ctx.workspaceId}, ${id}, ${ctx.userId}, 'manual', true)
    on conflict (issue_id, user_id) do update set muted = true`;
  return new Response(null, { status: 204 });
});
