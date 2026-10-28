import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { recordAudit, diffOf } from "../audit";
import { allocateIssueNumber } from "../../db/issues";
import { uuidv7 } from "../uuid7";
import { assertAssignee, assertTeamVisible, teamVisible } from "../resources/common";

const STATUS = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
const FIELDS = ["title", "description", "status", "priority", "assignee_id", "project_id", "cycle_id", "parent_id"];
const SCOPE = "issues:sort_key:asc";

const createBody = z.object({
  team_id: uuidSchema, title: z.string().min(1).max(255), description: z.string().max(100000).default(""),
  status: z.enum(STATUS).default("backlog"), priority: z.number().int().min(0).max(4).default(0),
  assignee_id: uuidSchema.nullable().default(null), project_id: uuidSchema.nullable().default(null),
  cycle_id: uuidSchema.nullable().default(null), parent_id: uuidSchema.nullable().default(null),
  label_ids: z.array(uuidSchema).max(50).default([]),
}).strict();
const patchBody = z.object({
  title: z.string().min(1).max(255), description: z.string().max(100000), status: z.enum(STATUS), priority: z.number().int().min(0).max(4),
  assignee_id: uuidSchema.nullable(), project_id: uuidSchema.nullable(), cycle_id: uuidSchema.nullable(), parent_id: uuidSchema.nullable(),
  label_ids: z.array(uuidSchema).max(50),
}).partial().strict();
const filters = listQuery.extend({
  status: z.enum(STATUS).optional(), team_id: uuidSchema.optional(), assignee_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(), cycle_id: uuidSchema.optional(), label_id: uuidSchema.optional(), parent_id: uuidSchema.optional(),
});

// Lexicographically sortable; new issues go to the end of the board. (Reordering is a later spec item.)
const newSortKey = () => Date.now().toString(36).padStart(10, "0") + Math.random().toString(36).slice(2, 8).padStart(6, "0");

type Row = Record<string, unknown>;
const dto = (r: Row) => ({
  id: r.id, identifier: `${r.team_key}-${r.number}`, team_id: r.team_id, number: r.number, title: r.title, description: r.description,
  status: r.status, priority: r.priority, assignee_id: r.assignee_id, project_id: r.project_id, cycle_id: r.cycle_id, parent_id: r.parent_id,
  label_ids: r.label_ids, version: r.version, created_by: r.created_by, deleted_at: r.deleted_at, created_at: r.created_at, updated_at: r.updated_at,
});

/** Guests see exactly the issues with an active share (v1.1 2.8); members the issues of their teams; admin+ the whole workspace. */
function visible(ctx: Ctx) {
  return ctx.role === "guest"
    ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)`
    : teamVisible(ctx, "i.team_id");
}
const SEL = (ctx: Ctx) => ctx.tx`select i.*, t.key as team_key, coalesce((select array_agg(label_id order by label_id) from issue_labels where issue_id = i.id), '{}') as label_ids
    from issues i join teams t on t.id = i.team_id and t.workspace_id = i.workspace_id`;
async function load(ctx: Ctx, id: string, deleted = false) {
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where i.id = ${id} and ${visible(ctx)} and ${deleted ? ctx.tx`i.deleted_at is not null` : ctx.tx`i.deleted_at is null`}`;
  if (rows.length === 0) throw new ApiError("not_found");
  return rows[0]!;
}
const out = (r: Row, status = 200) => Response.json(dto(r), { status, headers: { ETag: `"${r.version}"` } });
async function setLabels(ctx: Ctx, issueId: string, ids: string[]) {
  await ctx.tx`delete from issue_labels where issue_id = ${issueId}`;
  for (const l of new Set(ids)) await ctx.tx`insert into issue_labels (workspace_id, issue_id, label_id) values (${ctx.workspaceId}, ${issueId}, ${l})`; // composite FK rejects foreign-tenant labels
}
/** A cycle belongs to one team; an issue may only use a cycle of its own team (same 422 for unknown / foreign cycle). */
async function assertCycleTeam(ctx: Ctx, cycleId: string, teamId: string) {
  const r = await ctx.tx`select 1 from cycles where id = ${cycleId} and team_id = ${teamId}`;
  if (r.length === 0) throw new ApiError("validation_failed", "cycle must belong to the issue's team");
}
const stale = (r: Row) => new ApiError("precondition_failed", "stale version", { current_version: r.version });

export const listIssues = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, filters);
  const cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, SCOPE) : null;
  const t = ctx.tx, none = t``;
  const rows = await t<Row[]>`${SEL(ctx)} where i.deleted_at is null and ${visible(ctx)}
      ${q.status ? t`and i.status = ${q.status}` : none} ${q.team_id ? t`and i.team_id = ${q.team_id}` : none}
      ${q.assignee_id ? t`and i.assignee_id = ${q.assignee_id}` : none} ${q.project_id ? t`and i.project_id = ${q.project_id}` : none}
      ${q.cycle_id ? t`and i.cycle_id = ${q.cycle_id}` : none} ${q.parent_id ? t`and i.parent_id = ${q.parent_id}` : none}
      ${q.label_id ? t`and exists (select 1 from issue_labels l where l.issue_id = i.id and l.label_id = ${q.label_id})` : none}
      ${cur ? t`and (i.sort_key, i.id) > (${cur.k}::text collate "C", ${cur.id}::uuid)` : none}
    order by i.sort_key asc, i.id asc limit ${q.limit + 1}`;
  const p = page(rows, q.limit, ctx.workspaceId, SCOPE, (r) => ({ k: r.sort_key as string, id: r.id as string }));
  return Response.json({ items: p.items.map(dto), next_cursor: p.next_cursor });
});

export const createIssue = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, createBody);
  await assertTeamVisible(ctx, b.team_id); // same 422 for a team the member is not in as for an unknown one
  const n = await allocateIssueNumber(ctx.tx, b.team_id).catch(() => { throw new ApiError("validation_failed", "unknown team"); });
  const id = uuidv7();
  if (b.assignee_id) await assertAssignee(ctx, b.assignee_id);
  if (b.cycle_id) await assertCycleTeam(ctx, b.cycle_id, b.team_id);
  await ctx.tx`insert into issues (id, workspace_id, team_id, number, title, description, status, priority, assignee_id, project_id, cycle_id, parent_id, sort_key, created_by)
    values (${id}, ${ctx.workspaceId}, ${b.team_id}, ${n}, ${b.title}, ${b.description}, ${b.status}, ${b.priority}, ${b.assignee_id}, ${b.project_id}, ${b.cycle_id}, ${b.parent_id}, ${newSortKey()}, ${ctx.userId})`;
  await setLabels(ctx, id, b.label_ids);
  const row = await load(ctx, id);
  const diff = diffOf(null, row, FIELDS);
  if (b.label_ids.length) diff.label_ids = { before: [], after: row.label_ids };
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "create", diff });
  const res = out(row, 201);
  res.headers.set("Location", `/api/v1/w/${slug}/issues/${id}`);
  return res;
});

export const getIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await load(ctx, parseId(rawId))));

export const patchIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, patchBody);
  const before = await load(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  if (b.assignee_id) await assertAssignee(ctx, b.assignee_id);
  if (b.cycle_id) await assertCycleTeam(ctx, b.cycle_id, before.team_id as string);
  const pick = <K extends keyof typeof b>(k: K, cur: unknown) => (b[k] !== undefined ? b[k] : cur);
  // The version predicate is in the UPDATE too: closes the race between the read above and this write.
  const upd = await ctx.tx`update issues set title = ${pick("title", before.title) as string}, description = ${pick("description", before.description) as string},
    status = ${pick("status", before.status) as never}, priority = ${pick("priority", before.priority) as number},
    assignee_id = ${pick("assignee_id", before.assignee_id) as string | null}, project_id = ${pick("project_id", before.project_id) as string | null},
    cycle_id = ${pick("cycle_id", before.cycle_id) as string | null}, parent_id = ${pick("parent_id", before.parent_id) as string | null},
    version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (upd.length === 0) throw stale(before);
  if (b.label_ids) await setLabels(ctx, id, b.label_ids);
  const after = await load(ctx, id);
  const diff = diffOf(before, after, FIELDS);
  if (b.label_ids && JSON.stringify(before.label_ids) !== JSON.stringify(after.label_ids)) diff.label_ids = { before: before.label_ids, after: after.label_ids };
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "update", diff });
  return out(after);
});

export const deleteIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), row = await load(ctx, id), want = ifMatchVersion(req); // 404 (visibility) before 428
  if (Number(row.version) !== want) throw stale(row);
  const upd = await ctx.tx`update issues set deleted_at = now(), version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (upd.length === 0) throw stale(row);
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "delete", diff: { deleted_at: { before: null, after: "now" } } });
  return new Response(null, { status: 204 });
});

export const restoreIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), row = await load(ctx, id, true);
  if (Date.now() - new Date(row.deleted_at as string).getTime() > 30 * 86400_000) throw new ApiError("not_found"); // purge window: 30 days
  await ctx.tx`update issues set deleted_at = null, version = version + 1, updated_at = now() where id = ${id}`;
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "restore", diff: { deleted_at: { before: "deleted", after: null } } });
  return out(await load(ctx, id));
});
