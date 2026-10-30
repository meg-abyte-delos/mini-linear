import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { decodeCursor, page } from "../http/cursor";
import { recordAudit } from "../audit";
import { uuidv7 } from "../uuid7";
import { SEL, dto, load, visible, norm, meta } from "./handlers";

/** API types. 'blocked_by' is the inverse view of a stored 'blocks'; 'duplicate' means issue_id duplicates related_issue_id. */
export const RELATION_TYPES = ["blocks", "blocked_by", "related", "duplicate"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
const createBody = z.object({ type: z.enum(RELATION_TYPES), related_issue_id: uuidSchema, cancel_source: z.boolean().default(true) }).strict();

type Row = Record<string, unknown>;
/** Canonical storage form of a relation as seen from `from`. */
export function canonical(type: RelationType, from: string, to: string): { type: "blocks" | "related" | "duplicate"; issue_id: string; related_issue_id: string } {
  if (type === "blocked_by") return { type: "blocks", issue_id: to, related_issue_id: from };
  if (type === "related") return from < to ? { type, issue_id: from, related_issue_id: to } : { type, issue_id: to, related_issue_id: from };
  return { type, issue_id: from, related_issue_id: to };
}
/** A stored row presented from the point of view of issue `self`: issue_id is always `self`. */
export function view(r: Row, self: string) {
  const base = viewBase(r, self);
  return r.o_id ? { ...base, related_issue: { id: r.o_id, identifier: r.o_identifier, title: r.o_title, status: r.o_status, priority: r.o_priority, assignee_id: r.o_assignee_id, team_id: r.o_team_id } } : base;
}
function viewBase(r: Row, self: string) {
  const out = r.issue_id === self;
  const other = (out ? r.related_issue_id : r.issue_id) as string;
  const type: RelationType = r.type === "blocks" && !out ? "blocked_by" : (r.type as RelationType);
  return { id: r.id, type, issue_id: self, related_issue_id: other, direction: r.type === "related" ? "both" : out ? "outgoing" : "incoming", created_by: r.created_by, created_at: r.created_at };
}

// Only relations whose other end the caller can see (team visibility / guest share) are listed.
const listFor = (ctx: Ctx, id: string) => ctx.tx<Row[]>`select r.*, i.id as o_id, t.key || '-' || i.number as o_identifier, i.title as o_title, i.status as o_status,
    i.priority as o_priority, i.assignee_id as o_assignee_id, i.team_id as o_team_id from issue_relations r
  join issues i on i.id = case when r.issue_id = ${id} then r.related_issue_id else r.issue_id end
  join teams t on t.id = i.team_id
  where (r.issue_id = ${id} or r.related_issue_id = ${id}) and i.deleted_at is null and ${visible(ctx)}
  order by r.created_at, r.id`;

export const listRelations = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await load(ctx, id);
  return Response.json({ items: (await listFor(ctx, id)).map((r) => view(r, id)) });
});

export const createRelation = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), b = await parseJson(req, createBody);
  const self = await load(ctx, id);
  if (b.related_issue_id === id) throw new ApiError("validation_failed", "an issue cannot relate to itself");
  const other = await load(ctx, b.related_issue_id).catch(() => { throw new ApiError("validation_failed", "unknown related issue"); }); // same 422 for foreign / invisible
  const c = canonical(b.type, id, b.related_issue_id), rid = uuidv7();
  const ins = await ctx.tx<Row[]>`insert into issue_relations (id, workspace_id, type, issue_id, related_issue_id, created_by)
    values (${rid}, ${ctx.workspaceId}, ${c.type}, ${c.issue_id}, ${c.related_issue_id}, ${ctx.userId})
    on conflict do nothing returning *`;
  if (ins.length === 0) {
    const ex = await ctx.tx<Row[]>`select * from issue_relations where (issue_id = ${id} and related_issue_id = ${b.related_issue_id}) or (issue_id = ${b.related_issue_id} and related_issue_id = ${id}) limit 1`;
    const v = ex[0] ? view(ex[0], id) : null;
    throw new ApiError("conflict", "these issues are already related", v ? { relation_id: v.id, type: v.type } : undefined);
  }
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "relation_add",
    diff: { relation: { before: null, after: { id: rid, type: b.type, related_issue_id: b.related_issue_id } } } });
  // Linear parity: marking an issue as a duplicate moves it to the canceled category.
  // cancel_source (default true = behaviour already on main) can be turned off by the client.
  if (c.type === "duplicate" && b.cancel_source && self.status !== "canceled") {
    await ctx.tx`update issues set status = 'canceled', version = version + 1, updated_at = now() where id = ${id}`;
    await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "update",
      diff: { status: { before: self.status, after: "canceled" } } });
  }
  const res = Response.json(view({ ...ins[0]!, o_id: other.id, o_identifier: other.identifier ?? `${other.team_key}-${other.number}`, o_title: other.title, o_status: other.status, o_priority: other.priority, o_assignee_id: other.assignee_id, o_team_id: other.team_id }, id), { status: 201 });
  res.headers.set("Location", `/api/v1/w/${slug}/issues/${id}/relations/${rid}`);
  return res;
});

export const deleteRelation = (req: Request, slug: string, rawId: string, rawRid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), rid = parseId(rawRid); await load(ctx, id);
  const rel = (await listFor(ctx, id)).find((r) => r.id === rid);
  if (!rel) throw new ApiError("not_found");
  await ctx.tx`delete from issue_relations where id = ${rid}`;
  const v = view(rel, id);
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "relation_remove",
    diff: { relation: { before: { id: rid, type: v.type, related_issue_id: v.related_issue_id }, after: null } } });
  return new Response(null, { status: 204 });
});

/** Direct sub-issues (non-deleted, visible to the caller), in board order. */
export const listChildren = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await load(ctx, id);
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where i.parent_id = ${id} and i.deleted_at is null and ${visible(ctx)} order by i.sort_key asc, i.id asc limit 500`;
  const m = await meta(ctx, slug);
  return Response.json({ items: rows.map((r) => dto(norm(r), m)) });
});

const subQuery = listQuery.extend({ include: z.enum(["children", "descendants"]).default("children") });
/**
 * A4: GET /issues/:id/sub-issues. children (default) or the whole visible subtree flattened with `depth` (1..4), ordered
 * (sort_key, id), keyset-paginated. Hidden / deleted nodes are skipped together with their subtree.
 */
export const listSubIssues = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await load(ctx, id);
  const q = parseQuery(req, subQuery), scope = `sub-issues:${id}:${q.include}`;
  const cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, scope) : null, t = ctx.tx, none = t``;
  const depths = new Map<string, number>();
  let scopeSql = t`i.parent_id = ${id}`;
  if (q.include === "descendants") {
    const d = await t<{ id: string; depth: number }[]>`with recursive d(id, depth) as (
        select i.id, 1 from issues i where i.parent_id = ${id} and i.deleted_at is null and ${visible(ctx)}
        union all select i.id, d.depth + 1 from issues i join d on i.parent_id = d.id where i.deleted_at is null and d.depth < 4 and ${visible(ctx)})
      select id, depth from d`;
    for (const r of d) depths.set(r.id, r.depth);
    scopeSql = t`i.id = any(${[...depths.keys()]}::uuid[])`;
  }
  const rows = await t<Row[]>`${SEL(ctx)} where ${scopeSql} and i.deleted_at is null and ${visible(ctx)}
    ${cur ? t`and (i.sort_key, i.id) > (${cur.k}::text collate "C", ${cur.id}::uuid)` : none} order by i.sort_key asc, i.id asc limit ${q.limit + 1}`;
  rows.forEach(norm);
  const m = await meta(ctx, slug), p = page(rows, q.limit, ctx.workspaceId, scope, (r) => ({ k: r.sort_key as string, id: r.id as string }));
  return Response.json({ items: p.items.map((r) => (q.include === "descendants" ? { ...dto(r, m), depth: depths.get(r.id as string) ?? 1 } : dto(r, m))), next_cursor: p.next_cursor });
});
