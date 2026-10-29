// Server side of the change feed: read sync_events after a cursor, filtered to what the caller may read.
import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { withWorkspaceCtx, type Ctx } from '../../http/ctx';
import { ApiError } from '../../http/errors';
import { parseId } from '../../http/validate';
import { teamVisible } from '../../resources/common';

export type FeedEvent = { id: string; entity: 'issue' | 'comment'; entity_id: string; issue_id: string; op: 'create' | 'update' | 'delete'; version: number };
export type FeedPage = { events: FeedEvent[]; cursor: string; resync: boolean };
export const FEED_LIMIT = 500;

const secret = () => {
  const k = process.env.CURSOR_SECRET ?? process.env.SESSION_SECRET;
  if (!k || k.length < 16) { if (process.env.NODE_ENV === 'production') throw new Error('CURSOR_SECRET missing'); return 'dev-only-cursor-secret'; }
  return k;
};
/**
 * Cursors and event ids are SEALED per (workspace, user): one AES-256 block = id (8 bytes) + 8-byte HMAC tag, key derived from
 * CURSOR_SECRET. A client sees opaque tokens, not the workspace sequence, so gaps and heads reveal nothing about writes in
 * teams it cannot see; tokens are deterministic (dedup works), unforgeable, and useless for another user or workspace.
 */
const sealKey = (ws: string, user: string) => createHmac('sha256', secret()).update(`sync-cursor:${ws}:${user}`).digest();
const tag = (k: Buffer, id: bigint) => createHmac('sha256', k).update(`tag:${id}`).digest().subarray(0, 8);
export function sealId(ws: string, user: string, id: bigint): string {
  const k = sealKey(ws, user), b = Buffer.alloc(16);
  b.writeBigUInt64BE(id, 0); tag(k, id).copy(b, 8);
  const c = createCipheriv('aes-256-ecb', k, null); c.setAutoPadding(false);
  return Buffer.concat([c.update(b), c.final()]).toString('base64url');
}
/** Opens a sealed token: bigint, or null when absent/empty; throws 'bad' for anything not minted for this user+workspace. */
export function openId(ws: string, user: string, v: string | null | undefined): bigint | null {
  if (v == null || v.trim() === '') return null;
  const t = v.trim();
  if (!/^[A-Za-z0-9_-]{22}$/.test(t)) throw new Error('bad');
  const k = sealKey(ws, user), d = createDecipheriv('aes-256-ecb', k, null); d.setAutoPadding(false);
  const b = Buffer.concat([d.update(Buffer.from(t, 'base64url')), d.final()]);
  if (b.length !== 16) throw new Error('bad');
  const id = b.readBigUInt64BE(0);
  if (id > BigInt(Number.MAX_SAFE_INTEGER) || !timingSafeEqual(b.subarray(8), tag(k, id))) throw new Error('bad');
  return id;
}

/** Same visibility as GET /issues/:id: guest via active share, member via team, admin+ all. Deleted issues still
 * emit their delete event (payload is ids only). */
const visible = (ctx: Ctx) => ctx.role === 'guest'
  ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = e.issue_id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)`
  : ctx.tx`exists (select 1 from issues i where i.id = e.issue_id and ${teamVisible(ctx, 'i.team_id')})`;

/** `cursor` is the sealed token the client got last time (or null/undefined = start now). A token that is not ours, ahead of the head or older than the pruned mark => resync with a fresh cursor. */
export async function readFeed(ctx: Ctx, cursor: string | null | undefined): Promise<FeedPage> {
  const [s] = await ctx.tx<{ seq: string; pruned_upto: string }[]>`select seq::text, pruned_upto::text from sync_seq`;
  const head = BigInt(s?.seq ?? '0'), pruned = BigInt(s?.pruned_upto ?? '0');
  const seal = (id: bigint) => sealId(ctx.workspaceId, ctx.userId, id);
  let after: bigint | null = null, forged = false;
  try { after = openId(ctx.workspaceId, ctx.userId, cursor); } catch { forged = true; }
  // No cursor: start at the head (no historical replay). Unknown / ahead of head / pruned cursor: explicit resync.
  if (!forged && after === null) return { events: [], cursor: seal(head), resync: false };
  if (forged || after! > head || after! < pruned) return { events: [], cursor: seal(head), resync: true };
  const rows = await ctx.tx<{ id: string; entity: FeedEvent['entity']; entity_id: string; issue_id: string; op: FeedEvent['op']; version: number }[]>`select e.id::text as id, e.entity, e.entity_id, e.issue_id, e.op, e.version from sync_events e
    where e.id > ${after!.toString()}::bigint and ${visible(ctx)} order by e.id limit ${FEED_LIMIT}`;
  // Advance past invisible events too (to the last scanned id), so a client never re-reads them: the cursor is sealed, so this reveals nothing.
  const scanned = rows.length === FEED_LIMIT ? BigInt(rows[rows.length - 1]!.id) : head;
  return { events: rows.map((r) => ({ ...r, id: seal(BigInt(r.id)) })), cursor: seal(scanned), resync: false };
}

const q = z.object({ after: z.string().max(64).optional() });
/** GET /api/v1/w/:slug/sync?after=N : one page of the feed as JSON (polling fallback; the SSE route uses readFeed). */
export const getFeed = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const p = q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) throw new ApiError('validation_failed', 'bad cursor');
  return Response.json(await readFeed(ctx, p.data.after ?? null), { headers: { 'cache-control': 'no-store' } });
});

// ------------------------------------------------------------------ presence
export const PRESENCE_TTL_S = 30;
async function assertIssueVisible(ctx: Ctx, id: string) {
  const r = ctx.role === 'guest'
    ? await ctx.tx`select 1 from issue_shares s join issues i on i.id = s.issue_id where s.issue_id = ${id} and s.guest_user_id = ${ctx.userId} and s.revoked_at is null and i.deleted_at is null`
    : await ctx.tx`select 1 from issues i where i.id = ${id} and i.deleted_at is null and ${teamVisible(ctx, 'i.team_id')}`;
  if (r.length === 0) throw new ApiError('not_found');
}
const viewers = async (ctx: Ctx, id: string) => {
  const rows = await ctx.tx<{ user_id: string; seen_at: string }[]>`select user_id, seen_at from issue_presence
    where issue_id = ${id} and seen_at > now() - make_interval(secs => ${PRESENCE_TTL_S}) order by seen_at desc`;
  // Guests get a count only: other users' ids (internal members) are not theirs to see. They still see themselves.
  return ctx.role === 'guest' ? { viewers: rows.filter((r) => r.user_id === ctx.userId), count: rows.length } : { viewers: rows, count: rows.length };
};
async function touch(ctx: Ctx, method: string, id: string) {
  await assertIssueVisible(ctx, id);
  if (method === 'POST') await ctx.tx`insert into issue_presence (workspace_id, issue_id, user_id) values (${ctx.workspaceId}, ${id}, ${ctx.userId})
    on conflict (issue_id, user_id) do update set seen_at = now()`;
  if (method === 'DELETE') await ctx.tx`delete from issue_presence where issue_id = ${id} and user_id = ${ctx.userId}`;
  return Response.json(await viewers(ctx, id), { headers: { 'cache-control': 'no-store' } });
}
/** POST = heartbeat (I am viewing), DELETE = leave, GET = who is viewing now. */
export const presence = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, (ctx) => touch(ctx, req.method, parseId(rawId)));
/** POST/DELETE /api/v1/w/:slug/presence {issue_id}: same as the per-issue route, id in the body. */
export const presenceBody = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const b = z.object({ issue_id: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!b.success) throw new ApiError('validation_failed', 'issue_id required');
  return touch(ctx, req.method, parseId(b.data.issue_id));
});

export type PresenceSnapshot = { issue_id: string; viewers: string[]; count: number };
/** Fresh viewers of every issue the caller can see, one entry per issue. Guests get themselves and a count only. */
export async function readPresence(ctx: Ctx): Promise<PresenceSnapshot[]> {
  const vis = ctx.role === 'guest'
    ? ctx.tx`exists (select 1 from issue_shares s join issues i on i.id = s.issue_id where s.issue_id = p.issue_id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null and i.deleted_at is null)`
    : ctx.tx`exists (select 1 from issues i where i.id = p.issue_id and i.deleted_at is null and ${teamVisible(ctx, 'i.team_id')})`;
  const rows = await ctx.tx<{ issue_id: string; user_id: string }[]>`select p.issue_id, p.user_id from issue_presence p
    where p.seen_at > now() - make_interval(secs => ${PRESENCE_TTL_S}) and ${vis} order by p.issue_id, p.user_id`; // stable order: no event every poll when nothing changed
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.issue_id, [...(m.get(r.issue_id) ?? []), r.user_id]);
  return [...m].map(([issue_id, ids]) => ({ issue_id, viewers: ctx.role === 'guest' ? ids.filter((u) => u === ctx.userId) : ids, count: ids.length }));
}
