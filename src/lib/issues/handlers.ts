import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { decodeCursor, page } from "../http/cursor";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { recordAudit, diffOf } from "../audit";
import { allocateIssueNumber } from "../../db/issues";
import { uuidv7 } from "../uuid7";
import { assertAssignee, assertTeamVisible, assertTeamWrite, teamVisible } from "../resources/common";
import { subscribe } from "../resources/subscriptions";
import { getTemplateRow } from "../resources/templates";
import { emit } from "../notifications";
import { between } from "./sortkey";
import { ESTIMATE_SCALES, estimateValues, type EstimateScale } from "../team-config";

const STATUS = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
const FIELDS = ["title", "description", "status", "priority", "assignee_id", "project_id", "cycle_id", "parent_id", "state_id", "estimate", "due_date"];
const SCOPE = "issues:sort_key:asc";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v), "invalid date");
const estimate = z.number().int().min(0).max(64);
const createBody = z.object({
  team_id: uuidSchema, title: z.string().trim().min(1).max(255), description: z.string().max(100000).default(""),
  status: z.enum(STATUS).default("backlog"), priority: z.number().int().min(0).max(4).default(0),
  assignee_id: uuidSchema.nullable().default(null), project_id: uuidSchema.nullable().default(null),
  cycle_id: uuidSchema.nullable().default(null), parent_id: uuidSchema.nullable().default(null),
  label_ids: z.array(uuidSchema).max(50).default([]),
  state_id: uuidSchema.optional(), estimate: estimate.nullable().default(null), due_date: date.nullable().default(null),
}).strict();
// Optional issue template (area 9): its fields fill whatever the request left at its default; the request always wins.
const createBodyT = createBody.extend({ title: z.string().trim().min(1).max(255).optional(), template_id: uuidSchema.optional() });
async function applyTemplate(ctx: Parameters<typeof assertTeamVisible>[0], raw: z.infer<typeof createBodyT>) {
  const { template_id, ...b } = raw;
  let title = b.title;
  if (template_id) {
    const t = (await getTemplateRow(ctx, b.team_id, template_id).catch(() => { throw new ApiError("validation_failed", "unknown template"); })) as { title: string; description: string; priority: number; label_ids: string[] };
    title = title ?? (t.title || undefined);
    if (b.description === "") b.description = t.description;
    if (b.priority === 0) b.priority = t.priority;
    if (!b.label_ids.length) b.label_ids = t.label_ids;
  }
  if (!title) throw new ApiError("validation_failed", "title required");
  return { ...b, title };
}
const patchBody = z.object({
  title: z.string().trim().min(1).max(255), description: z.string().max(100000), status: z.enum(STATUS), priority: z.number().int().min(0).max(4),
  assignee_id: uuidSchema.nullable(), project_id: uuidSchema.nullable(), cycle_id: uuidSchema.nullable(), parent_id: uuidSchema.nullable(),
  label_ids: z.array(uuidSchema).max(50), state_id: uuidSchema, estimate: estimate.nullable(), due_date: date.nullable(),
  // Reorder among siblings (same parent): place right before / after another issue. Changes sort_key only.
  move: z.union([z.object({ before_id: uuidSchema }).strict(), z.object({ after_id: uuidSchema }).strict()]),
}).partial().strict();
const filters = listQuery.extend({
  status: z.enum(STATUS).optional(), team_id: uuidSchema.optional(), assignee_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(), cycle_id: uuidSchema.optional(), label_id: uuidSchema.optional(), parent_id: z.union([uuidSchema, z.literal("none")]).optional(),
  state_id: uuidSchema.optional(), estimate: z.coerce.number().int().min(0).max(64).optional(),
  due_before: date.optional(), due_after: date.optional(), has_due_date: z.enum(["true", "false"]).optional(),
  include_archived: z.enum(["true", "false"]).optional(),
});

// Lexicographically sortable; new issues go to the end of the board. (Reordering is a later spec item.)
const newSortKey = () => Date.now().toString(36).padStart(10, "0") + Math.random().toString(36).slice(2, 8).padStart(6, "0");

type Row = Record<string, unknown>;
export const norm = (r: Row) => { r.due_date = r.due_date_text ?? null; delete r.due_date_text; return r; };
/** Per-request values the DTO needs that are not columns: the workspace slug (url) and the requester's handle (branch_name). */
export type Meta = { slug: string; handle: string };

/** URL-safe lowercase slug: ascii letters/digits, runs of anything else collapsed to one dash, trimmed to max chars without a trailing dash. */
export function slugify(s: string, max = 60): string {
  const base = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, max).replace(/-+$/g, "");
}
/** Linear's git branch format: <user>/<team-key-lower>-<n>-<title-slug (max 60)>. */
export function branchName(handle: string, teamKey: string, n: number, title: string): string {
  const t = slugify(title);
  return `${slugify(handle, 39) || "user"}/${teamKey.toLowerCase()}-${n}${t ? `-${t}` : ""}`;
}
export const handleOf = (email: string) => email.split("@")[0] ?? "";
/** A4: own estimate + sum of the non-null estimates of the direct children (null when no child has one). */
export const rollup = (own: number | null | undefined, children: number | string | null | undefined) => {
  const o = own ?? null, c = children === null || children === undefined ? null : Number(children);
  return { own: o, children: c, total: (o ?? 0) + (c ?? 0) };
};
export const dto = (r: Row, m: Meta) => {
  const identifier = `${r.team_key}-${r.number}`;
  return {
    id: r.id, identifier, team_id: r.team_id, number: r.number, title: r.title, description: r.description,
    status: r.status, priority: r.priority, assignee_id: r.assignee_id, project_id: r.project_id, cycle_id: r.cycle_id, parent_id: r.parent_id,
    state_id: r.state_id, estimate: r.estimate ?? null, due_date: r.due_date ?? null,
    label_ids: r.label_ids, sub_issues: { total: Number(r.sub_total ?? 0), done: Number(r.sub_done ?? 0), in_progress: Number(r.sub_in_progress ?? 0) },
    estimate_rollup: rollup(r.estimate as number | null | undefined, r.est_children as number | string | null | undefined),
    parent: r.parent_id ? { id: r.parent_id, identifier: r.parent_identifier ?? null, title: r.parent_title ?? null } : null, version: r.version, created_by: r.created_by, deleted_at: r.deleted_at, archived_at: r.archived_at ?? null,
    branch_name: branchName(m.handle, r.team_key as string, Number(r.number), r.title as string),
    url: `/w/${encodeURIComponent(m.slug)}/issue/${identifier}`,
    created_at: r.created_at, updated_at: r.updated_at,
  };
};
export async function meta(ctx: Ctx, slug: string): Promise<Meta> {
  const u = await ctx.tx<{ email: string }[]>`select email from users where id = ${ctx.userId}`;
  return { slug, handle: handleOf(u[0]?.email ?? "") };
}

/** Guests see exactly the issues with an active share (v1.1 2.8); members the issues of their teams; admin+ the whole workspace. */
export function visible(ctx: Ctx) {
  return ctx.role === "guest"
    ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)`
    : teamVisible(ctx, "i.team_id");
}
export const SEL = (ctx: Ctx) => ctx.tx`select i.*, t.key as team_key, coalesce((select array_agg(label_id order by label_id) from issue_labels where issue_id = i.id), '{}') as label_ids,
    i.due_date::text as due_date_text,
    (select count(*) from issues c where c.parent_id = i.id and c.deleted_at is null) as sub_total,
    (select count(*) from issues c where c.parent_id = i.id and c.deleted_at is null and c.status = 'done') as sub_done,
    (select count(*) from issues c join workflow_states ws on ws.id = c.state_id where c.parent_id = i.id and c.deleted_at is null and ws.category = 'started') as sub_in_progress,
    (select sum(c.estimate) from issues c where c.parent_id = i.id and c.deleted_at is null and c.estimate is not null) as est_children,
    pi.title as parent_title, case when pi.id is null then null else pt.key || '-' || pi.number end as parent_identifier
    from issues i join teams t on t.id = i.team_id and t.workspace_id = i.workspace_id
    left join issues pi on pi.id = i.parent_id and pi.workspace_id = i.workspace_id and pi.deleted_at is null
    left join teams pt on pt.id = pi.team_id`;
export async function load(ctx: Ctx, id: string, deleted = false) {
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where i.id = ${id} and ${visible(ctx)} and ${deleted ? ctx.tx`i.deleted_at is not null` : ctx.tx`i.deleted_at is null`}`;
  if (rows.length === 0) throw new ApiError("not_found");
  return norm(rows[0]!);
}
const out = async (ctx: Ctx, slug: string, r: Row, status = 200) => Response.json(dto(r, await meta(ctx, slug)), { status, headers: { ETag: `"${r.version}"` } });
async function setLabels(ctx: Ctx, issueId: string, ids: string[]) {
  await ctx.tx`delete from issue_labels where issue_id = ${issueId}`;
  for (const l of new Set(ids)) await ctx.tx`insert into issue_labels (workspace_id, issue_id, label_id) values (${ctx.workspaceId}, ${issueId}, ${l})`; // composite FK rejects foreign-tenant labels
}
/** A cycle belongs to one team; an issue may only use a cycle of its own team (same 422 for unknown / foreign cycle). */
async function assertCycleTeam(ctx: Ctx, cycleId: string, teamId: string) {
  const r = await ctx.tx`select 1 from cycles where id = ${cycleId} and team_id = ${teamId}`;
  if (r.length === 0) throw new ApiError("validation_failed", "cycle must belong to the issue's team");
}
/** Same 422 for an unknown state and a state of another team. */
async function assertStateTeam(ctx: Ctx, stateId: string, teamId: string) {
  const r = await ctx.tx`select 1 from workflow_states where id = ${stateId} and team_id = ${teamId}`;
  if (r.length === 0) throw new ApiError("validation_failed", "state must belong to the issue's team");
}
/**
 * A4: a parent must be a live issue the caller can see, in the child's team. Same 422 for unknown / foreign / soft-deleted /
 * invisible parents (no existence leak); a visible parent of another team gets its own message.
 */
export async function assertParent(ctx: Ctx, parentId: string, teamId: string) {
  const r = await ctx.tx<{ team_id: string }[]>`select i.team_id from issues i where i.id = ${parentId} and i.deleted_at is null and ${visible(ctx)}`;
  if (r.length === 0) throw new ApiError("validation_failed", "referenced entity not found");
  if (r[0]!.team_id !== teamId) throw new ApiError("validation_failed", "sub-issue must be in the parent's team");
}
/** New sort_key placing `row` right before / after `anchor`, among issues with the same parent (siblings). */
async function moveKey(ctx: Ctx, row: Row, mv: { before_id: string } | { after_id: string }) {
  const anchorId = "before_id" in mv ? mv.before_id : mv.after_id;
  const a = await load(ctx, anchorId).catch(() => { throw new ApiError("validation_failed", "move target not found"); });
  if (a.id === row.id || (a.parent_id ?? null) !== (row.parent_id ?? null)) throw new ApiError("validation_failed", "move target must be a different sibling (same parent)");
  const sib = ctx.tx`i.deleted_at is null and i.id <> ${row.id as string} and i.parent_id is not distinct from ${(row.parent_id ?? null) as string | null} and ${visible(ctx)}`;
  const k = a.sort_key as string;
  if ("before_id" in mv) {
    const p = await ctx.tx<{ sort_key: string }[]>`select i.sort_key from issues i where ${sib} and i.sort_key < ${k} collate "C" order by i.sort_key desc limit 1`;
    return between(p[0]?.sort_key ?? null, k);
  }
  const n = await ctx.tx<{ sort_key: string }[]>`select i.sort_key from issues i where ${sib} and i.sort_key > ${k} collate "C" order by i.sort_key asc limit 1`;
  return between(k, n[0]?.sort_key ?? null);
}
export const stale = (r: Row) => new ApiError("precondition_failed", "stale version", { current_version: r.version });
/**
 * An estimate must be one of the team scale values. Scale "none" (the default) does not restrict, so existing clients and
 * data keep working; null (clearing) is always allowed. Same 422 for every endpoint.
 */
export async function assertEstimate(ctx: Ctx, teamId: string, estimate: number | null | undefined) {
  if (estimate === null || estimate === undefined) return;
  const r = await ctx.tx`select estimate_scale, estimate_allow_zero from team_settings where team_id = ${teamId}`;
  const scale = (r[0]?.estimate_scale ?? "none") as string;
  if (scale === "none" || !(ESTIMATE_SCALES as readonly string[]).includes(scale)) return;
  if (!estimateValues(scale as EstimateScale, !!r[0]?.estimate_allow_zero).includes(estimate)) throw new ApiError("validation_failed", "estimate is not allowed by the team's estimate scale");
}

export const listIssues = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, filters);
  const cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, SCOPE) : null;
  const t = ctx.tx, none = t``;
  const rows = await t<Row[]>`${SEL(ctx)} where i.deleted_at is null and ${visible(ctx)} ${q.include_archived === "true" ? none : t`and i.archived_at is null`}
      ${q.status ? t`and i.status = ${q.status}` : none} ${q.team_id ? t`and i.team_id = ${q.team_id}` : none}
      ${q.assignee_id ? t`and i.assignee_id = ${q.assignee_id}` : none} ${q.project_id ? t`and i.project_id = ${q.project_id}` : none}
      ${q.cycle_id ? t`and i.cycle_id = ${q.cycle_id}` : none} ${q.parent_id ? (q.parent_id === "none" ? t`and i.parent_id is null` : t`and i.parent_id = ${q.parent_id}`) : none}
      ${q.state_id ? t`and i.state_id = ${q.state_id}` : none} ${q.estimate !== undefined ? t`and i.estimate = ${q.estimate}` : none}
      ${q.due_before ? t`and i.due_date <= ${q.due_before}::date` : none} ${q.due_after ? t`and i.due_date >= ${q.due_after}::date` : none}
      ${q.has_due_date ? (q.has_due_date === "true" ? t`and i.due_date is not null` : t`and i.due_date is null`) : none}
      ${q.label_id ? t`and exists (select 1 from issue_labels l where l.issue_id = i.id and l.label_id = ${q.label_id})` : none}
      ${cur ? t`and (i.sort_key, i.id) > (${cur.k}::text collate "C", ${cur.id}::uuid)` : none}
    order by i.sort_key asc, i.id asc limit ${q.limit + 1}`;
  rows.forEach(norm);
  const m = await meta(ctx, slug);
  const p = page(rows, q.limit, ctx.workspaceId, SCOPE, (r) => ({ k: r.sort_key as string, id: r.id as string }));
  return Response.json({ items: p.items.map((r) => dto(r, m)), next_cursor: p.next_cursor });
});

export const createIssue = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const raw = await parseJson(req, createBodyT);
  await assertTeamVisible(ctx, raw.team_id); // same 422 for a team the member is not in as for an unknown one
  await assertTeamWrite(ctx, raw.team_id); // team guests are read-only
  const b = await applyTemplate(ctx, raw);
  const n = await allocateIssueNumber(ctx.tx, b.team_id).catch(() => { throw new ApiError("validation_failed", "unknown team"); });
  const id = uuidv7();
  if (b.assignee_id) await assertAssignee(ctx, b.assignee_id);
  if (b.cycle_id) await assertCycleTeam(ctx, b.cycle_id, b.team_id);
  if (b.parent_id) await assertParent(ctx, b.parent_id, b.team_id);
  await assertEstimate(ctx, b.team_id, b.estimate);
  if (b.state_id) await assertStateTeam(ctx, b.state_id, b.team_id); // state_id wins over status (trigger derives status)
  await ctx.tx`insert into issues (id, workspace_id, team_id, number, title, description, status, priority, assignee_id, project_id, cycle_id, parent_id, sort_key, created_by, state_id, estimate, due_date)
    values (${id}, ${ctx.workspaceId}, ${b.team_id}, ${n}, ${b.title}, ${b.description}, ${b.status}, ${b.priority}, ${b.assignee_id}, ${b.project_id}, ${b.cycle_id}, ${b.parent_id}, ${newSortKey()}, ${ctx.userId},
      ${b.state_id ?? null}, ${b.estimate}, ${b.due_date})`;
  await setLabels(ctx, id, b.label_ids);
  await subscribe(ctx, id, [ctx.userId], "creator");
  await subscribe(ctx, id, [b.assignee_id], "assignee");
  const row = await load(ctx, id);
  const diff = diffOf(null, row, FIELDS);
  if (b.label_ids.length) diff.label_ids = { before: [], after: row.label_ids };
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "create", diff });
  await emit(ctx, { kind: "issue_created", issueId: id, assigneeId: b.assignee_id ?? null });
  const res = await out(ctx, slug, row, 201);
  res.headers.set("Location", `/api/v1/w/${slug}/issues/${id}`);
  return res;
});

export const getIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(ctx, slug, await load(ctx, parseId(rawId))));

export const patchIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, patchBody);
  const before = await load(ctx, id);
  await assertTeamWrite(ctx, before.team_id as string);
  if (Number(before.version) !== want) throw stale(before);
  if (b.assignee_id) await assertAssignee(ctx, b.assignee_id);
  if (b.cycle_id) await assertCycleTeam(ctx, b.cycle_id, before.team_id as string);
  if (b.parent_id && b.parent_id !== before.parent_id) await assertParent(ctx, b.parent_id, before.team_id as string);
  if (b.state_id) await assertStateTeam(ctx, b.state_id, before.team_id as string);
  await assertEstimate(ctx, before.team_id as string, b.estimate);
  const sortKey = b.move ? await moveKey(ctx, before, b.move) : (before.sort_key as string);
  const pick = <K extends keyof typeof b>(k: K, cur: unknown) => (b[k] !== undefined ? b[k] : cur);
  // The version predicate is in the UPDATE too: closes the race between the read above and this write.
  const upd = await ctx.tx`update issues set title = ${pick("title", before.title) as string}, description = ${pick("description", before.description) as string},
    status = ${pick("status", before.status) as never}, priority = ${pick("priority", before.priority) as number},
    assignee_id = ${pick("assignee_id", before.assignee_id) as string | null}, project_id = ${pick("project_id", before.project_id) as string | null},
    cycle_id = ${pick("cycle_id", before.cycle_id) as string | null}, parent_id = ${pick("parent_id", before.parent_id) as string | null},
    state_id = ${pick("state_id", before.state_id) as string}, estimate = ${pick("estimate", before.estimate) as number | null},
    due_date = ${pick("due_date", before.due_date) as string | null}, sort_key = ${sortKey},
    version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (upd.length === 0) throw stale(before);
  if (b.label_ids) await setLabels(ctx, id, b.label_ids);
  if (b.assignee_id && b.assignee_id !== before.assignee_id) await subscribe(ctx, id, [b.assignee_id], "assignee");
  const after = await load(ctx, id);
  const diff = diffOf(before, after, FIELDS);
  if (b.label_ids && JSON.stringify(before.label_ids) !== JSON.stringify(after.label_ids)) diff.label_ids = { before: before.label_ids, after: after.label_ids };
  if (Object.keys(diff).length) await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "update", diff }); // a no-op PATCH leaves no empty event in the feed
  await emit(ctx, { kind: "issue_updated", issueId: id, before: { assignee_id: before.assignee_id, status: before.status }, after: { assignee_id: after.assignee_id, status: after.status } });
  return out(ctx, slug, after);
});

export const deleteIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), row = await load(ctx, id), want = ifMatchVersion(req); // 404 (visibility) before 428
  await assertTeamWrite(ctx, row.team_id as string);
  if (Number(row.version) !== want) throw stale(row);
  const upd = await ctx.tx`update issues set deleted_at = now(), version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (upd.length === 0) throw stale(row);
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "delete", diff: { deleted_at: { before: null, after: "now" } } });
  return new Response(null, { status: 204 });
});

export const restoreIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), row = await load(ctx, id, true);
  await assertTeamWrite(ctx, row.team_id as string);
  if (Date.now() - new Date(row.deleted_at as string).getTime() > PURGE_MS) throw new ApiError("not_found"); // purge window: 30 days
  // deleted_at predicate: a concurrent restore (or the purge job) must not be double-applied / resurrect a purged row.
  const upd = await ctx.tx`update issues set deleted_at = null, version = version + 1, updated_at = now() where id = ${id} and deleted_at is not null returning id`;
  if (upd.length === 0) throw new ApiError("not_found");
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "restore", diff: { deleted_at: { before: "deleted", after: null } } });
  return out(ctx, slug, await load(ctx, id));
});

const PURGE_MS = 30 * 86400_000;

/** Archive / unarchive: idempotent, bump version, audited. Archived issues are hidden from lists unless include_archived=true. */
async function setArchived(ctx: Ctx, id: string, on: boolean) {
  const row = await load(ctx, id);
  await assertTeamWrite(ctx, row.team_id as string);
  if (Boolean(row.archived_at) === on) return false;
  await ctx.tx`update issues set archived_at = ${on ? ctx.tx`now()` : null}, version = version + 1, updated_at = now() where id = ${id}`;
  await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: on ? "archive" : "unarchive",
    diff: { archived_at: { before: on ? null : "archived", after: on ? "now" : null } } });
  return true;
}
export const archiveIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId); await setArchived(ctx, id, true); return out(ctx, slug, await load(ctx, id));
});
export const unarchiveIssue = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId); await setArchived(ctx, id, false); return out(ctx, slug, await load(ctx, id));
});

export const BULK_MAX = 250;
const bulkPatch = z.object({
  status: z.enum(STATUS), priority: z.number().int().min(0).max(4), assignee_id: uuidSchema.nullable(),
  project_id: uuidSchema.nullable(), cycle_id: uuidSchema.nullable(),
  label_ids_add: z.array(uuidSchema).max(50), label_ids_remove: z.array(uuidSchema).max(50),
  add_label_ids: z.array(uuidSchema).max(50), remove_label_ids: z.array(uuidSchema).max(50), // aliases of label_ids_add / label_ids_remove
  estimate: estimate.nullable(),
}).partial().strict().refine((p) => Object.keys(p).length > 0, "empty patch");
// versions: optional per-issue If-Match ({ [issue_id]: version }); a stale one fails that issue alone (precondition_failed).
const versions = z.record(uuidSchema, z.number().int().min(1)).optional();
const bulkBody = z.union([
  z.object({ ids: z.array(uuidSchema).min(1).max(BULK_MAX), patch: bulkPatch, versions }).strict(),
  z.object({ ids: z.array(uuidSchema).min(1).max(BULK_MAX), action: z.enum(["archive", "unarchive", "delete", "restore"]), versions }).strict(),
]);

/**
 * POST /issues/bulk. One transaction; each issue runs in its own SAVEPOINT so a per-issue failure (not visible, bad cycle,
 * foreign label...) is reported and rolled back alone while the others commit. Same visibility/permission checks and one
 * audit row per issue as the single-issue endpoints. Response: { succeeded: id[], failed: {id, code, message}[] }.
 */
export const bulkIssues = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, bulkBody);
  const ids = [...new Set(b.ids)];
  if ("patch" in b && b.patch.assignee_id) await assertAssignee(ctx, b.patch.assignee_id); // request-level: same for every issue
  const succeeded: string[] = [], failed: { id: string; code: string; message: string; details?: unknown }[] = [];
  for (const id of ids) {
    try {
      await ctx.tx.savepoint(async () => {
        const want = b.versions?.[id];
        if (want !== undefined) {
          const cur = await load(ctx, id, "action" in b && b.action === "restore").catch(() => null);
          if (cur && Number(cur.version) !== want) throw stale(cur);
        }
        if ("patch" in b) await bulkPatchOne(ctx, id, b.patch);
        else if (b.action === "archive" || b.action === "unarchive") await setArchived(ctx, id, b.action === "archive");
        else if (b.action === "delete") {
          await assertTeamWrite(ctx, (await load(ctx, id)).team_id as string);
          await ctx.tx`update issues set deleted_at = now(), version = version + 1, updated_at = now() where id = ${id}`;
          await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "delete", diff: { deleted_at: { before: null, after: "now" } } });
        } else {
          const row = await load(ctx, id, true);
          await assertTeamWrite(ctx, row.team_id as string);
          if (Date.now() - new Date(row.deleted_at as string).getTime() > PURGE_MS) throw new ApiError("not_found");
          await ctx.tx`update issues set deleted_at = null, version = version + 1, updated_at = now() where id = ${id} and deleted_at is not null`;
          await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "restore", diff: { deleted_at: { before: "deleted", after: null } } });
        }
      });
      succeeded.push(id);
    } catch (e) {
      if (e instanceof ApiError) failed.push({ id, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
      else if (typeof e === "object" && e && "code" in e && String((e as { code: unknown }).code).startsWith("23")) failed.push({ id, code: "validation_failed", message: "constraint violation" });
      else throw e; // unexpected: abort the whole transaction
    }
  }
  return Response.json({ succeeded, failed }, { status: 200 });
});

async function bulkPatchOne(ctx: Ctx, id: string, p: z.infer<typeof bulkPatch>) {
  const before = await load(ctx, id);
  await assertTeamWrite(ctx, before.team_id as string);
  if (p.cycle_id) await assertCycleTeam(ctx, p.cycle_id, before.team_id as string);
  await assertEstimate(ctx, before.team_id as string, p.estimate);
  const v = <K extends keyof typeof p>(k: K, cur: unknown) => (p[k] !== undefined ? p[k] : cur);
  await ctx.tx`update issues set status = ${v("status", before.status) as never}, priority = ${v("priority", before.priority) as number},
    assignee_id = ${v("assignee_id", before.assignee_id) as string | null}, project_id = ${v("project_id", before.project_id) as string | null},
    cycle_id = ${v("cycle_id", before.cycle_id) as string | null}, estimate = ${v("estimate", before.estimate) as number | null}, version = version + 1, updated_at = now() where id = ${id}`;
  const add = [...(p.label_ids_add ?? []), ...(p.add_label_ids ?? [])], rem = [...(p.label_ids_remove ?? []), ...(p.remove_label_ids ?? [])];
  if (add.length || rem.length) {
    const cur = new Set(before.label_ids as string[]);
    for (const l of add) cur.add(l);
    for (const l of rem) cur.delete(l);
    await setLabels(ctx, id, [...cur]);
  }
  const after = await load(ctx, id);
  const diff = diffOf(before, after, FIELDS);
  if (JSON.stringify(before.label_ids) !== JSON.stringify(after.label_ids)) diff.label_ids = { before: before.label_ids, after: after.label_ids };
  if (Object.keys(diff).length) await recordAudit(ctx.tx, { workspaceId: ctx.workspaceId, actorId: ctx.userId, entity: "issue", entityId: id, action: "update", diff: { ...diff, bulk: { before: null, after: true } } });
}
