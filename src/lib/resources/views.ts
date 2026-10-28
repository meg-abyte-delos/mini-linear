import { z } from 'zod';
import { withWorkspaceCtx, requireRole, type Ctx } from '../http/ctx';
import { ApiError } from '../http/errors';
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from '../http/validate';
import { diffOf } from '../audit';
import { uuidv7 } from '../uuid7';
import { type Row, stale, out, audit, listPage, afterId, assertTeamVisible } from './common';

// Saved views: personal (owner only) or shared (every non-guest who can see the team).
// Writes: the owner; shared views can also be edited/deleted by admins/owners. Only the owner flips personal/shared.
const FIELDS = ['status', 'priority', 'assignee', 'label', 'project', 'cycle', 'team', 'created_at', 'updated_at', 'due_date'] as const;
const OPS = ['is', 'is_not', 'in', 'not_in', 'lt', 'gt', 'before', 'after', 'within', 'empty', 'not_empty'] as const;
const scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
const rule = z.object({ field: z.enum(FIELDS), op: z.enum(OPS), value: z.union([scalar, z.array(scalar).max(100)]).optional() }).strict();
type Group = { op: 'and' | 'or'; rules: (z.infer<typeof rule> | Group)[] };
const group: z.ZodType<Group> = z.lazy(() => z.object({ op: z.enum(['and', 'or']), rules: z.array(z.union([rule, group])).max(50) }).strict());
const GROUPING = z.enum(['none', 'status', 'assignee', 'priority', 'project', 'cycle', 'label']);
const display = z.object({
  grouping: GROUPING.optional(), sub_grouping: GROUPING.optional(),
  ordering: z.enum(['manual', 'priority', 'created', 'updated', 'title']).optional(),
  show_empty_groups: z.boolean().optional(), show_sub_issues: z.boolean().optional(),
  properties: z.array(z.string().max(32)).max(20).optional(),
}).strict().refine((d) => !d.sub_grouping || (!!d.grouping && d.grouping !== 'none' && d.sub_grouping !== d.grouping), 'sub_grouping needs a different grouping');
const body = z.object({
  name: z.string().trim().min(1).max(80), shared: z.boolean(), team_id: uuidSchema.nullable(),
  layout: z.enum(['list', 'board']), filters: group, display,
}).strict();
const F = ['name', 'shared', 'team_id', 'layout', 'filters', 'display'];
const SEL = (ctx: Ctx) => ctx.tx`select id, owner_id, team_id, name, shared, layout, filters, display, version, created_at, updated_at from saved_views`;

/** Visible = own, or shared; a shared view scoped to a team is hidden from members outside it (404 either way). */
const visible = (ctx: Ctx) => {
  const t = ctx.tx;
  if (ctx.role === 'guest') return t`false`;
  const teamOk = ctx.role === 'owner' || ctx.role === 'admin' ? t`true`
    : t`(team_id is null or exists (select 1 from team_memberships tm where tm.team_id = saved_views.team_id and tm.user_id = ${ctx.userId}))`;
  return t`(owner_id = ${ctx.userId} or (shared and ${teamOk}))`;
};
const getView = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${SEL(ctx)} where id = ${id} and ${visible(ctx)}`;
  if (!r[0]) throw new ApiError('not_found');
  return r[0];
};
const mustWrite = (ctx: Ctx, v: Row) => {
  const ok = v.owner_id === ctx.userId || (!!v.shared && (ctx.role === 'owner' || ctx.role === 'admin'));
  if (!ok) throw new ApiError('forbidden');
};
const json = (ctx: Ctx, v: unknown) => ctx.tx.json(v as never);

export const listViews = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const q = parseQuery(req, listQuery), c = afterId(ctx, 'views', q);
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where ${visible(ctx)} and ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, 'views', q, rows);
});
export const createView = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const b = await parseJson(req, body.partial({ shared: true, team_id: true, layout: true, filters: true, display: true })), id = uuidv7();
  if (b.team_id) await assertTeamVisible(ctx, b.team_id);
  await ctx.tx`insert into saved_views (id, workspace_id, owner_id, team_id, name, shared, layout, filters, display)
    values (${id}, ${ctx.workspaceId}, ${ctx.userId}, ${b.team_id ?? null}, ${b.name}, ${b.shared ?? false}, ${b.layout ?? 'list'},
      ${json(ctx, b.filters ?? { op: 'and', rules: [] })}, ${json(ctx, b.display ?? {})})`;
  const row = await getView(ctx, id);
  await audit(ctx, 'saved_view', id, 'create', diffOf(null, row, F));
  return out(row, 201);
});
export const getViewH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { requireRole(ctx, 'member'); return out(await getView(ctx, parseId(rawId))); });
export const patchView = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, body.partial());
  const before = await getView(ctx, id);
  mustWrite(ctx, before);
  if (Number(before.version) !== want) throw stale(before);
  if (b.team_id) await assertTeamVisible(ctx, b.team_id);
  const shared = b.shared ?? (before.shared as boolean);
  if (shared !== before.shared && before.owner_id !== ctx.userId) throw new ApiError('forbidden');
  const u = await ctx.tx`update saved_views set name = ${b.name ?? (before.name as string)}, shared = ${shared},
    team_id = ${b.team_id === undefined ? (before.team_id as string | null) : b.team_id}, layout = ${b.layout ?? (before.layout as string)},
    filters = ${json(ctx, b.filters ?? before.filters)}, display = ${json(ctx, b.display ?? before.display)},
    version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getView(ctx, id);
  await audit(ctx, 'saved_view', id, 'update', diffOf(before, row, F));
  return out(row);
});
export const deleteView = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getView(ctx, id);
  mustWrite(ctx, before);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from saved_views where id = ${id}`;
  await audit(ctx, 'saved_view', id, 'delete', diffOf(before, null, F));
  return new Response(null, { status: 204 });
});
