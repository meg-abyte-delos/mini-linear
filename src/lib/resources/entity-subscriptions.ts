import { z } from 'zod';
import { withWorkspaceCtx, requireRole, type Ctx } from '../http/ctx';
import { ApiError } from '../http/errors';
import { parseQuery, uuidSchema } from '../http/validate';
import { teamVisible } from './common';

const KINDS = ['project', 'cycle', 'team', 'label'] as const;
type Kind = (typeof KINDS)[number];
const MAX = 200;
const kindOf = (raw: string): Kind => {
  if (!(KINDS as readonly string[]).includes(raw)) throw new ApiError('validation_failed', 'kind must be project, cycle, team or label');
  return raw as Kind;
};

/** 404 for an entity that does not exist or that the caller cannot see (same answer for both). */
async function assertVisible(ctx: Ctx, kind: Kind, id: string) {
  const t = ctx.tx;
  const rows = kind === 'team' ? await t`select 1 from teams where id = ${id} and ${teamVisible(ctx, 'team_id')}`
    : kind === 'cycle' ? await t`select 1 from cycles where id = ${id} and ${teamVisible(ctx, 'team_id')}`
    : kind === 'project' ? await t`select 1 from projects where id = ${id}`
    : await t`select 1 from labels where id = ${id}`;
  if (rows.length === 0) throw new ApiError('not_found');
}

const listQ = z.object({ kind: z.string().optional() });
/** GET /subscriptions?kind= : the caller's own entity subscriptions. */
export const listEntitySubscriptions = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const q = parseQuery(req, listQ), kind = q.kind ? kindOf(q.kind) : null;
  const rows = await ctx.tx`select kind, entity_id, created_at from entity_subscriptions where user_id = ${ctx.userId} ${kind ? ctx.tx`and kind = ${kind}` : ctx.tx``} order by created_at desc, entity_id limit ${MAX}`;
  return Response.json({ items: rows });
});

/** PUT (subscribe, idempotent 204) / DELETE (unsubscribe, idempotent 204) /subscriptions/:kind/:entityId. */
export const entitySubscription = (req: Request, slug: string, rawKind: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, 'member');
  const kind = kindOf(rawKind), idr = uuidSchema.safeParse(rawId);
  if (!idr.success) throw new ApiError('validation_failed', 'entityId must be a uuid');
  const id = idr.data;
  if (req.method === 'DELETE') {
    await ctx.tx`delete from entity_subscriptions where user_id = ${ctx.userId} and kind = ${kind} and entity_id = ${id}`;
    return new Response(null, { status: 204 });
  }
  await assertVisible(ctx, kind, id);
  const have = await ctx.tx`select 1 from entity_subscriptions where user_id = ${ctx.userId} and kind = ${kind} and entity_id = ${id}`;
  if (have.length === 0) {
    const [c] = await ctx.tx<{ n: number }[]>`select count(*)::int as n from entity_subscriptions where user_id = ${ctx.userId}`;
    if (c!.n >= MAX) throw new ApiError('validation_failed', `at most ${MAX} subscriptions`);
    await ctx.tx`insert into entity_subscriptions (workspace_id, user_id, kind, entity_id) values (${ctx.workspaceId}, ${ctx.userId}, ${kind}, ${id}) on conflict do nothing`;
  }
  return new Response(null, { status: 204 });
});
