import type { Ctx } from "../http/ctx";

/**
 * Realtime hook for attachment changes. sync_events.entity only allows issue|comment today (A6 owns the extension),
 * so until the shared A6 helper lands an attachment change is announced as an `issue` update on its parent
 * (ids and version only; clients refetch through the authorised GET). Replace the body when the A6 helper is merged.
 */
export async function emitAttachmentEvent(ctx: Ctx, issueId: string, issueVersion: number): Promise<void> {
  const t = ctx.tx;
  const [s] = await t<{ seq: string }[]>`insert into sync_seq as s (workspace_id, seq) values (${ctx.workspaceId}, 1)
    on conflict (workspace_id) do update set seq = s.seq + 1 returning s.seq::text as seq`;
  await t`insert into sync_events (workspace_id, id, entity, entity_id, issue_id, op, version, actor_id)
    values (${ctx.workspaceId}, ${s!.seq}::bigint, 'issue', ${issueId}, ${issueId}, 'update', ${issueVersion}, ${ctx.userId})`;
}
