import type { Ctx } from './http/ctx';
import { uuidv7 } from './uuid7';

export type NotificationType = 'assigned' | 'mention' | 'comment' | 'status_change' | 'due_soon' | 'reply' | 'sub_issue' | 'relation';
export type FollowKind = 'project' | 'cycle' | 'team' | 'label';
/** Issue facts the entity-subscription fan-out needs (all optional: missing = not applicable). */
export type IssueScope = { teamId?: string | null; projectId?: string | null; cycleId?: string | null; labelIds?: string[] };
export type NotifyEvent =
  | { kind: 'issue_created'; issueId: string; assigneeId: string | null; parentId?: string | null; scope?: IssueScope }
  | { kind: 'issue_updated'; issueId: string; before: { assignee_id: unknown; status: unknown; parent_id?: unknown }; after: { assignee_id: unknown; status: unknown; parent_id?: unknown };
      scopeBefore?: IssueScope; scopeAfter?: IssueScope }
  | { kind: 'comment_created'; issueId: string; commentId: string; mentioned: string[]; parentCommentId?: string | null }
  | { kind: 'comment_updated'; issueId: string; commentId: string; mentioned: string[] }
  | { kind: 'relation_created'; issueId: string; relatedIssueId: string; type: string }
  | { kind: 'due_soon'; issueId: string; recipientId: string };

async function fan(ctx: Ctx, type: NotificationType, issueId: string, commentId: string | null, recipients: Iterable<string>, meta: Record<string, unknown> = {}) {
  let n = 0;
  for (const r of new Set(recipients)) {
    if (r === ctx.userId) continue; // the actor never notifies self (notify() re-checks)
    const [row] = await ctx.tx<{ ok: boolean }[]>`select notify(${uuidv7()}, ${r}, ${type}::notification_type, ${issueId}, ${commentId}, ${ctx.tx.json(meta as never)}) as ok`;
    if (row?.ok) n++;
  }
  return n;
}
/** Followers who have not opted out (muted = tombstone of an explicit unsubscribe). Plain tenant RLS on issue_subscribers (0103). */
const subscribers = async (ctx: Ctx, issueId: string) =>
  (await ctx.tx<{ user_id: string }[]>`select user_id from issue_subscribers where issue_id = ${issueId} and not muted`).map((x) => x.user_id);
/** Subscribers of a project / cycle / team / label: only through the SECURITY DEFINER entity_subscribers() (own_rows RLS hides other users' rows). */
const entitySubscribers = async (ctx: Ctx, kind: FollowKind, id: string) =>
  (await ctx.tx<{ u: string }[]>`select entity_subscribers as u from entity_subscribers(${kind}, ${id}::uuid)`).map((x) => x.u);

/** An issue appeared in (created in / moved into) a followed project, cycle, team or label: sub_issue + meta.reason. One notification per user. */
async function followedEntities(ctx: Ctx, issueId: string, now: IssueScope, was: IssueScope = {}) {
  const add = <T>(a: T[] | undefined, b: T[] | undefined) => (a ?? []).filter((x) => !(b ?? []).includes(x));
  const targets: [FollowKind, string][] = [];
  const one = (k: FollowKind, a?: string | null, b?: string | null) => { if (a && a !== b) targets.push([k, a]); };
  one('team', now.teamId, was.teamId); one('project', now.projectId, was.projectId); one('cycle', now.cycleId, was.cycleId);
  for (const l of add(now.labelIds, was.labelIds)) targets.push(['label', l]);
  const reasonOf = new Map<string, FollowKind>();
  for (const [k, id] of targets) for (const u of await entitySubscribers(ctx, k, id)) if (!reasonOf.has(u)) reasonOf.set(u, k);
  let n = 0;
  for (const [u, k] of reasonOf) n += await fan(ctx, 'sub_issue', issueId, null, [u], { reason: `followed_${k}` });
  return n;
}

/**
 * Generate notifications for one event, inside the caller's transaction (same as audit): a failure rolls the mutation back.
 * Subscriptions are NOT written here: the issue/comment handlers already auto-subscribe into issue_subscribers (0103).
 * `mentioned` = users newly mentioned by this comment, already filtered by visibility in resolveMentions.
 * Recipients = followers (+ mentioned / new assignee), minus the actor, filtered by visibility and in_app preference in notify().
 * Returns the number of notifications created or coalesced.
 */
export async function emit(ctx: Ctx, ev: NotifyEvent): Promise<number> {
  switch (ev.kind) {
    case 'issue_created': {
      let n = ev.assigneeId ? await fan(ctx, 'assigned', ev.issueId, null, [ev.assigneeId]) : 0;
      if (ev.parentId) n += await fan(ctx, 'sub_issue', ev.parentId, null, await subscribers(ctx, ev.parentId), { child_id: ev.issueId });
      if (ev.scope) n += await followedEntities(ctx, ev.issueId, ev.scope);
      return n;
    }
    case 'issue_updated': {
      let n = 0;
      const { before, after } = ev;
      if (after.assignee_id && after.assignee_id !== before.assignee_id) n += await fan(ctx, 'assigned', ev.issueId, null, [after.assignee_id as string]);
      if (after.status !== before.status) n += await fan(ctx, 'status_change', ev.issueId, null, await subscribers(ctx, ev.issueId), { from: before.status, to: after.status });
      if (after.parent_id && after.parent_id !== before.parent_id) n += await fan(ctx, 'sub_issue', after.parent_id as string, null, await subscribers(ctx, after.parent_id as string), { child_id: ev.issueId });
      if (ev.scopeAfter) n += await followedEntities(ctx, ev.issueId, ev.scopeAfter, ev.scopeBefore);
      return n;
    }
    case 'comment_created':
    case 'comment_updated': {
      let n = await fan(ctx, 'mention', ev.issueId, ev.commentId, ev.mentioned);
      if (ev.kind === 'comment_created') {
        const followers = await subscribers(ctx, ev.issueId);
        if (ev.parentCommentId) {
          const [p] = await ctx.tx<{ author_id: string }[]>`select author_id from comments where id = ${ev.parentCommentId}`;
          n += await fan(ctx, 'reply', ev.issueId, ev.commentId, [...(p ? [p.author_id] : []), ...followers].filter((s) => !ev.mentioned.includes(s)));
        } else n += await fan(ctx, 'comment', ev.issueId, ev.commentId, followers.filter((s) => !ev.mentioned.includes(s)));
      }
      return n;
    }
    case 'relation_created': {
      const meta = { relation_type: ev.type };
      let n = await fan(ctx, 'relation', ev.issueId, null, await subscribers(ctx, ev.issueId), { ...meta, related_issue_id: ev.relatedIssueId });
      n += await fan(ctx, 'relation', ev.relatedIssueId, null, await subscribers(ctx, ev.relatedIssueId), { ...meta, related_issue_id: ev.issueId });
      return n;
    }
    case 'due_soon':
      return 0; // produced by the cron route (see resources/due-soon.ts)
  }
}
