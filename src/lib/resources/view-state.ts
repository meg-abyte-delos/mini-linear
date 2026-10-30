import { z } from 'zod';
import { withWorkspaceCtx, requireRole, type Ctx } from '../http/ctx';
import { ApiError } from '../http/errors';
import { ifMatchVersion, parseId, parseJson, uuidSchema } from '../http/validate';
import { type Row, out, stale } from './common';
import { SEL, visible, getView, viewFilters, viewDisplay } from './views';

// A5: per-user persisted list state (filters/display per scope) and per-user favourite views. Personal, never audited.
// RLS adds a RESTRICTIVE own_rows policy (app.user_id): even admins cannot read another user's rows.
const SCOPE = /^(all|my-issues|(team|project|cycle|view):[0-9a-f-]{36})$/;
const scopeSchema = z.string().max(64).regex(SCOPE).refine((s) => !s.includes(':') || uuidSchema.safeParse(s.split(':')[1]).success, 'bad id');
const FILTERS_MAX = 32768, DISPLAY_MAX = 8192, FAV_MAX = 50;
const bodySchema = z.object({ scope: scopeSchema, layout: z.enum(['list', 'board']), filters: viewFilters, display: viewDisplay }).strict();
const favBody = z.object({ position: z.number().int().min(0).max(100000).optional() }).strict();
const bad = (m: string) => new ApiError('validation_failed', m);
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
const DEFAULT_FILTERS = { op: 'and', rules: [] };
const shape = (r: Row) => ({ scope: r.scope, layout: r.layout, filters: r.filters, display: r.display, version: r.version, updated_at: r.updated_at });
const defaults = (scope: string) => ({ scope, layout: 'list', filters: DEFAULT_FILTERS, display: {}, version: 0, updated_at: null });
const json = (ctx: Ctx, v: unknown) => ctx.tx.json(v as never);

function scopeParam(req: Request, required: boolean): string | null {
  const v = new URL(req.url).searchParams.get('scope');
  if (v === null) { if (required) throw bad('scope required'); return null; }
  const p = scopeSchema.safeParse(v);
  if (!p.success) throw bad('invalid scope');
  return p.data;
}
/** team/project/cycle/view scopes must reference something the caller can see: one 404 either way. */
async function assertScopeVisible(ctx: Ctx, scope: string) {
  const i = scope.indexOf(':');
  if (i < 0) return;
  const kind = scope.slice(0, i), id = scope.slice(i + 1), t = ctx.tx, admin = ctx.role === 'owner' || ctx.role === 'admin';
  let r: readonly unknown[];
  if (kind === 'team') r = admin ? await t`select 1 from teams where id = ${id}` : await t`select 1 from team_memberships where team_id = ${id} and user_id = ${ctx.userId}`;
  else if (kind === 'project') r = admin ? await t`select 1 from projects where id = ${id}`
    : await t`select 1 from projects p where p.id = ${id} and exists (select 1 from project_teams pt join team_memberships tm on tm.team_id = pt.team_id and tm.workspace_id = pt.workspace_id where pt.project_id = p.id and tm.user_id = ${ctx.userId})`;
  else if (kind === 'cycle') r = admin ? await t`select 1 from cycles where id = ${id}` : await t`select 1 from cycles c where c.id = ${id} and exists (select 1 from team_memberships tm where tm.team_id = c.team_id and tm.user_id = ${ctx.userId})`;
  else r = await t`select 1 from saved_views where id = ${id} and ${visible(ctx)}`;
  if (!r.length) throw new ApiError('not_found');
}
const STATE_COLS = (ctx: Ctx) => ctx.tx`scope, layout, filters, display, version, updated_at`;

export const getViewState = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const scope = scopeParam(req, false);
  if (scope === null) {
    const rows = await ctx.tx<Row[]>`select ${STATE_COLS(ctx)} from user_view_state where user_id = ${ctx.userId} order by scope limit 100`;
    return Response.json({ items: rows.map(shape) });
  }
  await assertScopeVisible(ctx, scope);
  const r = await ctx.tx<Row[]>`select ${STATE_COLS(ctx)} from user_view_state where user_id = ${ctx.userId} and scope = ${scope}`;
  return r[0] ? out(shape(r[0])) : Response.json(defaults(scope), { headers: { ETag: '"0"' } });
});

export const putViewState = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const want = ifMatchVersion(req), b = await parseJson(req, bodySchema);
  if (size(b.filters) > FILTERS_MAX) throw bad('filters too large');
  if (size(b.display) > DISPLAY_MAX) throw bad('display too large');
  await assertScopeVisible(ctx, b.scope);
  const cur = await ctx.tx<Row[]>`select ${STATE_COLS(ctx)} from user_view_state where user_id = ${ctx.userId} and scope = ${b.scope} for update`;
  const have = cur[0] ? Number(cur[0].version) : 0;
  if (have !== want) throw stale(cur[0] ? shape(cur[0]) : { version: 0 });
  let r: Row[];
  try {
    r = cur[0]
      ? await ctx.tx<Row[]>`update user_view_state set layout = ${b.layout}, filters = ${json(ctx, b.filters)}, display = ${json(ctx, b.display)},
        version = version + 1, updated_at = now() where user_id = ${ctx.userId} and scope = ${b.scope} returning ${STATE_COLS(ctx)}`
      : await ctx.tx<Row[]>`insert into user_view_state (workspace_id, user_id, scope, layout, filters, display, version)
        values (${ctx.workspaceId}, ${ctx.userId}, ${b.scope}, ${b.layout}, ${json(ctx, b.filters)}, ${json(ctx, b.display)}, 1) returning ${STATE_COLS(ctx)}`;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw stale({ version: 1 }); // lost the race of two first PUTs: 412, never 500
    throw e;
  }
  return out(shape(r[0]!));
});

export const deleteViewState = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const scope = scopeParam(req, true)!;
  await ctx.tx`delete from user_view_state where user_id = ${ctx.userId} and scope = ${scope}`;
  return new Response(null, { status: 204 });
});

const favSel = (ctx: Ctx) => ctx.tx`select f.view_id, f.position from view_favorites f where f.user_id = ${ctx.userId}`;
export const listFavorites = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const favs = await ctx.tx<{ view_id: string; position: number }[]>`${favSel(ctx)} order by f.position, f.created_at, f.view_id`;
  if (!favs.length) return Response.json({ items: [] });
  const ids = favs.map((f) => f.view_id);
  const views = await ctx.tx<Row[]>`${SEL(ctx)} where id in ${ctx.tx(ids)} and ${visible(ctx)}`;
  const byId = new Map(views.map((v) => [v.id as string, v]));
  return Response.json({ items: favs.filter((f) => byId.has(f.view_id)).map((f) => ({ view_id: f.view_id, position: f.position, view: byId.get(f.view_id) })) });
});

export const putFavorite = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const id = parseId(rawId), raw = await req.text(), b = favBody.parse(raw.trim() ? JSON.parse(raw) : {});
  await getView(ctx, id);
  await ctx.tx`select pg_advisory_xact_lock(hashtextextended(${ctx.workspaceId + ':' + ctx.userId}, 0))`; // serialises the cap check per user
  const ex = await ctx.tx<{ position: number }[]>`select position from view_favorites where user_id = ${ctx.userId} and view_id = ${id}`;
  if (!ex.length) {
    const [c] = await ctx.tx<{ n: number; mx: number | null }[]>`select count(*)::int as n, max(f.position) as mx from view_favorites f join saved_views on saved_views.id = f.view_id where f.user_id = ${ctx.userId} and ${visible(ctx)}`; // hidden favourites do not count toward the cap
    if (c!.n >= FAV_MAX) throw bad(`at most ${FAV_MAX} favourite views`);
    const pos = b.position ?? (c!.mx === null ? 0 : c!.mx + 1);
    await ctx.tx`insert into view_favorites (workspace_id, user_id, view_id, position) values (${ctx.workspaceId}, ${ctx.userId}, ${id}, ${pos})`;
  } else if (b.position !== undefined) {
    await ctx.tx`update view_favorites set position = ${b.position} where user_id = ${ctx.userId} and view_id = ${id}`;
  }
  const [f] = await ctx.tx<{ view_id: string; position: number }[]>`${favSel(ctx)} and f.view_id = ${id}`;
  return Response.json({ view_id: f!.view_id, position: f!.position });
});
export const deleteFavorite = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  await ctx.tx`delete from view_favorites where user_id = ${ctx.userId} and view_id = ${parseId(rawId)}`;
  return new Response(null, { status: 204 });
});
