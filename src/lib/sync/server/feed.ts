// Server side of the change feed: read sync_events after a cursor, filtered to what the caller may read.
import { z } from 'zod';
import { withWorkspaceCtx, type Ctx } from '../../http/ctx';
import { ApiError } from '../../http/errors';
import { parseId } from '../../http/validate';
import { teamVisible } from '../../resources/common';

export type FeedEvent = { id: string; entity: 'issue' | 'comment'; entity_id: string; issue_id: string; op: 'create' | 'update' | 'delete'; version: number };
export type FeedPage = { events: FeedEvent[]; cursor: string; resync: boolean };
export const FEED_LIMIT = 500;

/** Cursor parse: a non-negative safe integer string, else null (caller starts fresh; never a 500). */
export function parseCursor(v: string | null | undefined): bigint | null {
  if (v == null || !/^\d{1,18}$/.test(v.trim())) return null;
  return BigInt(v.trim());
}

/** Same visibility as GET /issues/:id: guest via active share, member via team, admin+ all. Deleted issues still
 * emit their delete event (payload is ids only). */
const visible = (ctx: Ctx) => ctx.role === 'guest'
  ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = e.issue_id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)`
  : ctx.tx`exists (select 1 from issues i where i.id = e.issue_id and ${teamVisible(ctx, 'i.team_id')})`;

export async function readFeed(ctx: Ctx, after: bigint | null): Promise<FeedPage> {
  const [s] = await ctx.tx<{ seq: string; pruned_upto: string }[]>`select seq::text, pruned_upto::text from sync_seq`;
  const head = BigInt(s?.seq ?? '0'), pruned = BigInt(s?.pruned_upto ?? '0');
  // No cursor: start at the head (no historical replay). Cursor ahead of head (other workspace / forged): resync.
  if (after === null) return { events: [], cursor: head.toString(), resync: false };
  if (after > head || (after < pruned)) return { events: [], cursor: head.toString(), resync: true };
  const rows = await ctx.tx<FeedEvent[]>`select e.id::text as id, e.entity, e.entity_id, e.issue_id, e.op, e.version from sync_events e
    where e.id > ${after.toString()}::bigint and ${visible(ctx)} order by e.id limit ${FEED_LIMIT}`;
  // Advance the cursor past invisible events too (up to the last scanned id), so a client never re-reads them.
  const scanned = rows.length === FEED_LIMIT ? BigInt(rows[rows.length - 1]!.id) : head;
  return { events: rows, cursor: scanned.toString(), resync: false };
}

const q = z.object({ after: z.string().max(40).optional() });
/** GET /api/v1/w/:slug/sync?after=N : one page of the feed as JSON (polling fallback; the SSE route uses readFeed). */
export const getFeed = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const p = q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) throw new ApiError('validation_failed', 'bad cursor');
  return Response.json(await readFeed(ctx, parseCursor(p.data.after ?? null)), { headers: { 'cache-control': 'no-store' } });
});

// ------------------------------------------------------------------ presence
export const PRESENCE_TTL_S = 30;
async function assertIssueVisible(ctx: Ctx, id: string) {
  const r = ctx.role === 'guest'
    ? await ctx.tx`select 1 from issue_shares s join issues i on i.id = s.issue_id where s.issue_id = ${id} and s.guest_user_id = ${ctx.userId} and s.revoked_at is null and i.deleted_at is null`
    : await ctx.tx`select 1 from issues i where i.id = ${id} and i.deleted_at is null and ${teamVisible(ctx, 'i.team_id')}`;
  if (r.length === 0) throw new ApiError('not_found');
}
const viewers = (ctx: Ctx, id: string) => ctx.tx<{ user_id: string; seen_at: string }[]>`select user_id, seen_at from issue_presence
  where issue_id = ${id} and seen_at > now() - make_interval(secs => ${PRESENCE_TTL_S}) order by seen_at desc`;
/** POST = heartbeat (I am viewing), DELETE = leave, GET = who is viewing now. */
export const presence = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId);
  await assertIssueVisible(ctx, id);
  if (req.method === 'POST') await ctx.tx`insert into issue_presence (workspace_id, issue_id, user_id) values (${ctx.workspaceId}, ${id}, ${ctx.userId})
    on conflict (issue_id, user_id) do update set seen_at = now()`;
  if (req.method === 'DELETE') await ctx.tx`delete from issue_presence where issue_id = ${id} and user_id = ${ctx.userId}`;
  return Response.json({ viewers: await viewers(ctx, id) }, { headers: { 'cache-control': 'no-store' } });
});
