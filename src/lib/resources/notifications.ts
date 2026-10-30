import { z } from 'zod';
import { withWorkspaceCtx, type Ctx } from '../http/ctx';
import { ApiError } from '../http/errors';
import { decodeCursor, page } from '../http/cursor';
import { listQuery, parseId, parseJson, parseQuery } from '../http/validate';
import { teamVisible, type Row } from './common';
import { emitSync } from '../sync/emit';

const TYPES = ['assigned', 'mention', 'comment', 'status_change', 'due_soon', 'reply', 'sub_issue', 'relation'] as const;
const SCOPE = 'notifications';
const DAY = 86_400_000;

/** Same visibility as the issue itself (guests: active share; members: their teams; admin+: all). A notification whose issue became invisible is hidden. */
const issueVisibleSql = (ctx: Ctx) => {
  const t = ctx.tx;
  return t`exists (select 1 from issues i where i.id = n.issue_id and i.deleted_at is null and ${ctx.role === 'guest'
    ? t`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)` : teamVisible(ctx, 'i.team_id')})`;
};
// Active = not archived and not currently snoozed.
const ACTIVE = (ctx: Ctx) => ctx.tx`n.archived_at is null and (n.snoozed_until is null or n.snoozed_until <= now())`;

const SEL = (ctx: Ctx) => ctx.tx`select n.id, n.type, n.issue_id, n.comment_id, n.actor_id, n.read_at, n.archived_at, n.snoozed_until, n.created_at, n.coalesced_count, n.last_event_at, n.meta,
  (select jsonb_build_object('id', i.id, 'number', i.number, 'title', i.title, 'status', i.status, 'team_id', i.team_id, 'identifier', tm.key || '-' || i.number)
     from issues i join teams tm on tm.id = i.team_id where i.id = n.issue_id) as issue,
  (select jsonb_build_object('id', u.id, 'email', u.email) from users u where u.id = n.actor_id) as actor
  from notifications n`;

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const listSchema = listQuery.extend({ unread: bool.optional(), archived: bool.optional(), snoozed: bool.optional(), type: z.enum(TYPES).optional() });

export async function unreadCount(ctx: Ctx): Promise<number> {
  const [r] = await ctx.tx<{ c: number }[]>`select count(*)::int as c from notifications n where n.read_at is null and ${ACTIVE(ctx)} and ${issueVisibleSql(ctx)}`;
  return r!.c;
}

export const listNotifications = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, listSchema), t = ctx.tx;
  const c = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, SCOPE).id : null;
  const state = q.archived ? t`n.archived_at is not null` : q.snoozed ? t`n.archived_at is null and n.snoozed_until > now()` : ACTIVE(ctx);
  const rows = await t<Row[]>`${SEL(ctx)} where ${state} and ${issueVisibleSql(ctx)}
    ${q.unread === true ? t`and n.read_at is null` : q.unread === false ? t`and n.read_at is not null` : t``}
    ${q.type ? t`and n.type = ${q.type}::notification_type` : t``}
    ${c ? t`and n.id < ${c}::uuid` : t``} order by n.id desc limit ${q.limit + 1}`;
  const p = page(rows, q.limit, ctx.workspaceId, SCOPE, (r) => ({ k: r.id as string, id: r.id as string }));
  return Response.json({ items: p.items, next_cursor: p.next_cursor, unread_count: await unreadCount(ctx) });
});

export const getUnreadCount = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => Response.json({ unread_count: await unreadCount(ctx) }));

/** Foreign, missing, malformed and hidden-issue ids all give the same 404. */
async function load(ctx: Ctx, rawId: string): Promise<Row> {
  const id = parseId(rawId);
  const r = await ctx.tx<Row[]>`${SEL(ctx)} where n.id = ${id} and ${issueVisibleSql(ctx)}`;
  if (!r[0]) throw new ApiError('not_found');
  return r[0];
}
export const getNotification = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => Response.json(await load(ctx, rawId)));
export const deleteNotification = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const n = await load(ctx, rawId);
  await ctx.tx`delete from notifications where id = ${n.id as string}`;
  return new Response(null, { status: 204 });
});

type Touched = { id: string; issue_id: string; coalesced_count: number };
/** State changes (read, archive, snooze...) reach the user other tabs as a per-user notification update event. */
const touched = async (ctx: Ctx, rows: Touched[]) => { for (const r of rows) await emitSync(ctx, { entity: 'notification', id: r.id, op: 'update', version: r.coalesced_count, issueId: r.issue_id, userId: ctx.userId }); };

const snoozeBody = z.object({ until: z.string().datetime({ offset: true }) });
export type NotificationAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze';
export const notificationAction = (req: Request, slug: string, rawId: string, action: NotificationAction) => withWorkspaceCtx(req, slug, async (ctx) => {
  const n = await load(ctx, rawId), id = n.id as string, t = ctx.tx;
  switch (action) {
    case 'read': await t`update notifications set read_at = coalesce(read_at, now()) where id = ${id}`; break;
    case 'unread': await t`update notifications set read_at = null where id = ${id}`; break;
    case 'archive': await t`update notifications set archived_at = coalesce(archived_at, now()), read_at = coalesce(read_at, now()) where id = ${id}`; break;
    case 'unarchive': await t`update notifications set archived_at = null where id = ${id}`; break;
    case 'snooze': {
      const { until } = await parseJson(req, snoozeBody), at = new Date(until).getTime(), now = Date.now();
      if (at <= now) throw new ApiError('validation_failed', 'until must be in the future');
      if (at > now + 366 * DAY) throw new ApiError('validation_failed', 'until must be within one year');
      await t`update notifications set snoozed_until = ${new Date(at).toISOString()}::timestamptz where id = ${id}`; break;
    }
  }
  await touched(ctx, [{ id, issue_id: n.issue_id as string, coalesced_count: Number(n.coalesced_count) }]);
  return Response.json(await load(ctx, id));
});

/** Bulk: mark every visible active notification read. */
export const readAll = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const r = await ctx.tx<Touched[]>`update notifications n set read_at = now() where n.read_at is null and ${ACTIVE(ctx)} and ${issueVisibleSql(ctx)} returning n.id, n.issue_id, n.coalesced_count`;
  await touched(ctx, r);
  return Response.json({ updated: r.length });
});
/** Bulk: archive every already-read, non-archived notification. */
export const archiveRead = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const r = await ctx.tx<Touched[]>`update notifications n set archived_at = now() where n.read_at is not null and n.archived_at is null and ${issueVisibleSql(ctx)} returning n.id, n.issue_id, n.coalesced_count`;
  await touched(ctx, r);
  return Response.json({ updated: r.length });
});

// ---- Per-type preferences (in_app / email). Missing row = defaults (in_app true, email false). ----
const prefPatch = z.object({ in_app: z.boolean().optional(), email: z.boolean().optional() }).strict();
const prefsBody = z.object({ preferences: z.object(Object.fromEntries(TYPES.map((ty) => [ty, prefPatch.optional()])) as Record<(typeof TYPES)[number], z.ZodOptional<typeof prefPatch>>).strict() }).strict();
async function loadPrefs(ctx: Ctx) {
  const rows = await ctx.tx<{ type: string; in_app: boolean; email: boolean }[]>`select type, in_app, email from notification_preferences where user_id = ${ctx.userId}`;
  const by = new Map(rows.map((r) => [r.type, r]));
  return { preferences: Object.fromEntries(TYPES.map((ty) => [ty, { in_app: by.get(ty)?.in_app ?? true, email: by.get(ty)?.email ?? false }])) };
}
export const getPreferences = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => Response.json(await loadPrefs(ctx)));
export const putPreferences = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const body = await parseJson(req, prefsBody), cur = (await loadPrefs(ctx)).preferences as Record<string, { in_app: boolean; email: boolean }>;
  for (const [ty, p] of Object.entries(body.preferences)) {
    const inApp = p.in_app ?? cur[ty]!.in_app, email = p.email ?? cur[ty]!.email;
    await ctx.tx`insert into notification_preferences (workspace_id, user_id, type, in_app, email)
      values (${ctx.workspaceId}, ${ctx.userId}, ${ty}::notification_type, ${inApp}, ${email})
      on conflict (workspace_id, user_id, type) do update set in_app = excluded.in_app, email = excluded.email`;
  }
  return Response.json(await loadPrefs(ctx));
});

/** POST /notifications/bulk {ids (1..100), action}: per-id results; unknown, foreign and hidden ids report not_found without failing the batch. */
const bulkBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), action: z.enum(['read', 'unread', 'archive', 'unarchive']) }).strict();
export const bulkNotifications = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const b = await parseJson(req, bulkBody), t = ctx.tx, ids = [...new Set(b.ids)];
  const set = b.action === 'read' ? t`read_at = coalesce(n.read_at, now())` : b.action === 'unread' ? t`read_at = null`
    : b.action === 'archive' ? t`archived_at = coalesce(n.archived_at, now()), read_at = coalesce(n.read_at, now())` : t`archived_at = null`;
  const rows = await t<Touched[]>`update notifications n set ${set} where n.id in ${t(ids)} and ${issueVisibleSql(ctx)} returning n.id, n.issue_id, n.coalesced_count`;
  await touched(ctx, rows);
  const ok = new Set(rows.map((r) => r.id));
  return Response.json({ updated: rows.length, results: b.ids.map((id) => ({ id, status: ok.has(id) ? 'ok' : 'not_found' })), unread_count: await unreadCount(ctx) });
});
