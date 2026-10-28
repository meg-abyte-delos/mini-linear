import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId, parseJson, uuidSchema } from "../http/validate";
import { recordAudit } from "../audit";
import { uuidv7 } from "../uuid7";
import { SEL, dto, load, visible, norm, meta } from "./handlers";

/** API types. 'blocked_by' is the inverse view of a stored 'blocks'; 'duplicate' means issue_id duplicates related_issue_id. */
export const RELATION_TYPES = ["blocks", "blocked_by", "related", "duplicate"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
const createBody = z.object({ type: z.enum(RELATION_TYPES), related_issue_id: uuidSchema }).strict();

type Row = Record<string, unknown>;
/** Canonical storage form of a relation as seen from `from`. */
export function canonical(type: RelationType, from: string, to: string): { type: "blocks" | "related" | "duplicate"; issue_id: string; related_issue_id: string } {
  if (type === "blocked_by") return { type: "blocks", issue_id: to, related_issue_id: from };
  if (type === "related") return from < to ? { type, issue_id: from, related_issue_id: to } : { type, issue_id: to, related_issue_id: from };
  return { type, issue_id: from, related_issue_id: to };
}
/** A stored row presented from the point of view of issue `self`: issue_id is always `self`. */
export function view(r: Row, self: string) {
  const out = r.issue_id === self;
  const other = (out ? r.related_issue_id : r.issue_id) as string;
  const type: RelationType = r.type === "blocks" && !out ? "blocked_by" : (r.type as RelationType);
  return { id: r.id, type, issue_id: self, related_issue_id: other, direction: r.type === "related" ? "both" : out ? "outgoing" : "incoming", created_by: r.created_by, created_at: r.created_at };
}

// Only relations whose other end the caller can see (team visibility / guest share) are listed.
const listFor = (ctx: Ctx, id: string) => ctx.tx<Row[]>`select r.* from issue_relations r
  join issues i on i.id = case when r.issue_id = ${id} then r.related_issue_id else r.issue_id end
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
  await load(ctx, b.related_issue_id).catch(() => { throw new ApiError("validation_failed", "unknown related issue"); }); // same 422 for foreign / invisible
  const c = canonical(b.type, id, b.related_issue_id), rid = uuidv7();
  const ins = await ctx.tx<Row[]>`insert into issue_relations (id, workspace_id, type, issue_id, related_issue_id, created_by)
    values (${rid}, ${ctx.workspaceId}, ${c.type}, ${c.issue_id}, ${c.related_issue_id}, ${ctx.userId})
    on conflict do nothing returning *`;
  if (ins.length === 0) throw new ApiError("conflict", "these issues are already related");
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "relation_add",
    diff: { relation: { before: null, after: { id: rid, type: b.type, related_issue_id: b.related_issue_id } } } });
  // Linear parity: marking an issue as a duplicate moves it to the canceled category.
  if (c.type === "duplicate" && self.status !== "canceled") {
    await ctx.tx`update issues set status = 'canceled', version = version + 1, updated_at = now() where id = ${id}`;
    await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "update",
      diff: { status: { before: self.status, after: "canceled" } } });
  }
  const res = Response.json(view(ins[0]!, id), { status: 201 });
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
