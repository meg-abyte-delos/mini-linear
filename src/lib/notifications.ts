import type { Ctx } from "./http/ctx";
import { uuidv7 } from "./uuid7";

export type NotificationType = "assigned" | "mention" | "comment" | "status_change" | "due_soon";
export type NotifyEvent =
  | { kind: "issue_created"; issueId: string; assigneeId: string | null }
  | { kind: "issue_updated"; issueId: string; before: { assignee_id: unknown; status: unknown }; after: { assignee_id: unknown; status: unknown } }
  | { kind: "comment_created"; issueId: string; commentId: string; mentioned: string[] }
  | { kind: "comment_updated"; issueId: string; commentId: string; mentioned: string[] }
  | { kind: "due_soon"; issueId: string; recipientId: string };

async function fan(ctx: Ctx, type: NotificationType, issueId: string, commentId: string | null, recipients: Iterable<string>) {
  let n = 0;
  for (const r of new Set(recipients)) {
    if (r === ctx.userId) continue; // the actor never notifies self (notify() re-checks)
    const [row] = await ctx.tx<{ ok: boolean }[]>`select notify(${uuidv7()}, ${r}, ${type}::notification_type, ${issueId}, ${commentId}) as ok`;
    if (row?.ok) n++;
  }
  return n;
}
/** Followers who have not opted out (muted = tombstone of an explicit unsubscribe). Plain tenant RLS on issue_subscribers (0103). */
const subscribers = async (ctx: Ctx, issueId: string) =>
  (await ctx.tx<{ user_id: string }[]>`select user_id from issue_subscribers where issue_id = ${issueId} and not muted`).map((x) => x.user_id);

/**
 * Generate notifications for one event, inside the caller's transaction (same as audit): a failure rolls the mutation back.
 * Subscriptions are NOT written here: the issue/comment handlers already auto-subscribe into issue_subscribers (0103).
 * `mentioned` = users newly mentioned by this comment, already filtered by visibility in resolveMentions.
 * Recipients = followers (+ mentioned / new assignee), minus the actor, filtered by visibility and in_app preference in notify().
 * Returns the number of notifications created.
 */
export async function emit(ctx: Ctx, ev: NotifyEvent): Promise<number> {
  switch (ev.kind) {
    case "issue_created":
      return ev.assigneeId ? fan(ctx, "assigned", ev.issueId, null, [ev.assigneeId]) : 0;
    case "issue_updated": {
      let n = 0;
      const { before, after } = ev;
      if (after.assignee_id && after.assignee_id !== before.assignee_id) n += await fan(ctx, "assigned", ev.issueId, null, [after.assignee_id as string]);
      if (after.status !== before.status) n += await fan(ctx, "status_change", ev.issueId, null, await subscribers(ctx, ev.issueId));
      return n;
    }
    case "comment_created":
    case "comment_updated": {
      let n = await fan(ctx, "mention", ev.issueId, ev.commentId, ev.mentioned);
      if (ev.kind === "comment_created") {
        const rest = (await subscribers(ctx, ev.issueId)).filter((s) => !ev.mentioned.includes(s));
        n += await fan(ctx, "comment", ev.issueId, ev.commentId, rest);
      }
      return n;
    }
    case "due_soon":
      return 0; // generator exists so the scheduler can call it once issues have a due date
  }
}
