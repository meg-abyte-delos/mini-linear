import { type Ctx } from "../http/ctx";

export type SubReason = "creator" | "assignee" | "mention" | "commenter" | "manual";
/** Idempotent auto-subscribe (first reason wins). Guests are never auto-subscribed. Runs under RLS. */
export async function subscribe(ctx: Ctx, issueId: string, userIds: (string | null | undefined)[], reason: SubReason) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  if (!ids.length) return;
  await ctx.tx`insert into issue_subscribers (workspace_id, issue_id, user_id, reason)
    select ${ctx.workspaceId}, ${issueId}, m.user_id, ${reason} from memberships m where m.user_id in ${ctx.tx(ids)} and m.role <> 'guest'
    on conflict (issue_id, user_id) do nothing`;
}
