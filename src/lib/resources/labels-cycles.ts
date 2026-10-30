import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { decodeCursor, page } from "../http/cursor";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId, teamVisible, assertTeamVisible } from "./common";
import { scopeVisible, assertScopeAdmin } from "./team-settings";

// ------------------------------------------------ labels (workspace-wide when team_id is null, else team-level; optional group)
const LABEL_F = ["name", "color", "team_id", "group_id", "description"];
const labelBody = z.object({
  name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  team_id: uuidSchema.nullable(), group_id: uuidSchema.nullable(), description: z.string().max(500),
}).strict();
const LSEL = (ctx: Ctx) => ctx.tx`select id, team_id, group_id, name, color, description, version, created_at, updated_at from labels`;
const getLabel = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${LSEL(ctx)} where id = ${id} and ${scopeVisible(ctx, "labels")}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
const assertGroup = async (ctx: Ctx, groupId: string | null | undefined) => {
  if (!groupId) return;
  const r = await ctx.tx`select 1 from label_groups where id = ${groupId} and ${scopeVisible(ctx, "label_groups")}`;
  if (!r.length) throw new ApiError("validation_failed", "unknown group");
};
export const listLabels = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests: no labels (same as projects)
  const q = parseQuery(req, listQuery.extend({ team_id: uuidSchema.optional() })), c = afterId(ctx, "labels", q);
  const rows = await ctx.tx<Row[]>`${LSEL(ctx)} where ${scopeVisible(ctx, "labels")} and ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`}
    ${q.team_id ? ctx.tx`and (team_id is null or team_id = ${q.team_id})` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "labels", q, rows);
});
export const createLabel = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, labelBody.partial({ color: true, team_id: true, group_id: true, description: true })), id = uuidv7();
  if (b.team_id) {
    await assertTeamVisible(ctx, b.team_id);
    await assertScopeAdmin(ctx, b.team_id);
  }
  await assertGroup(ctx, b.group_id);
  await ctx.tx`insert into labels (id, workspace_id, team_id, group_id, name, color, description)
    values (${id}, ${ctx.workspaceId}, ${b.team_id ?? null}, ${b.group_id ?? null}, ${b.name}, ${b.color ?? "#888888"}, ${b.description ?? ""})`;
  const row = await getLabel(ctx, id);
  await audit(ctx, "label", id, "create", diffOf(null, row, LABEL_F));
  return out(row, 201);
});
export const getLabelH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { requireRole(ctx, "member"); return out(await getLabel(ctx, parseId(rawId))); });
export const patchLabel = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, labelBody.omit({ team_id: true }).partial()); // scope is immutable
  const before = await getLabel(ctx, id);
  if (before.team_id) await assertScopeAdmin(ctx, before.team_id as string);
  if (Number(before.version) !== want) throw stale(before);
  await assertGroup(ctx, b.group_id);
  const group = b.group_id === undefined ? (before.group_id as string | null) : b.group_id;
  const u = await ctx.tx`update labels set name = ${b.name ?? (before.name as string)}, color = ${b.color ?? (before.color as string)},
    group_id = ${group}, description = ${b.description ?? (before.description as string)}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getLabel(ctx, id);
  await audit(ctx, "label", id, "update", diffOf(before, row, LABEL_F));
  return out(row);
});
// Note: one audit row per affected issue (N inserts, not batched). Label deletes are rare and the per-issue rows are what the activity feed reads.
export const deleteLabel = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getLabel(ctx, id);
  await assertScopeAdmin(ctx, before.team_id as string | null);
  if (Number(before.version) !== want) throw stale(before);
  // issue_labels rows cascade: record the label removal on each affected issue's feed first.
  const tagged = await ctx.tx<Row[]>`select i.id, coalesce((select array_agg(label_id order by label_id) from issue_labels where issue_id = i.id), '{}') as label_ids
    from issues i where i.id in (select issue_id from issue_labels where label_id = ${id}) and i.deleted_at is null`;
  for (const t of tagged) {
    const b = t.label_ids as string[];
    await audit(ctx, "issue", t.id as string, "update", { label_ids: { before: b, after: b.filter((x) => x !== id) } });
  }
  await ctx.tx`delete from labels where id = ${id}`;
  await audit(ctx, "label", id, "delete", diffOf(before, null, LABEL_F));
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ cycles (per team, no overlap within a team)
const CYCLE_F = ["team_id", "name", "start_date", "end_date"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), "invalid date");
const cycleBody = z.object({ team_id: uuidSchema, name: z.string().trim().min(1).max(255), start_date: date, end_date: date }).strict();
/** scope = non-canceled issues of the cycle, completed = done, started = in_progress/in_review, canceled apart; percent_complete = completed / scope (0 when empty).
 *  Same numbers as GET /cycles/:id/stats. A cycle belongs to one team and the DB guard keeps its issues in that team, so team visibility of the cycle = visibility of its counts. */
const CSEL = (ctx: Ctx) => ctx.tx`select cycles.id, cycles.team_id, cycles.name, cycles.start_date::text as start_date, cycles.end_date::text as end_date, cycles.version, cycles.created_at, cycles.updated_at,
  st.scope, st.started, st.completed, st.canceled, case when st.scope = 0 then 0 else round(100.0 * st.completed / st.scope)::int end as percent_complete from cycles
  cross join lateral (select (count(*) filter (where i.status <> 'canceled'))::int as scope, (count(*) filter (where i.status in ('in_progress','in_review')))::int as started,
      (count(*) filter (where i.status = 'done'))::int as completed, (count(*) filter (where i.status = 'canceled'))::int as canceled
    from issues i where i.cycle_id = cycles.id and i.deleted_at is null) st`;
const getCycle = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${CSEL(ctx)} where id = ${id} and ${teamVisible(ctx, "team_id")}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
const ordered = (s: string, e: string) => { if (e < s) throw new ApiError("validation_failed", "end_date before start_date"); };
/** List order: running/upcoming cycles first (soonest start first), then past cycles most recent first (Linear).
 *  Keyset on (sk, id); sk is an int derived from the dates, computed in SQL for the filter and in JS (same formula) for the cursor. */
const CYCLE_SK = (t: Ctx["tx"]) => t`case when cycles.end_date >= current_date then cycles.start_date - date '2000-01-01' else 1000000 + (date '2100-01-01' - cycles.start_date) end`;
const dayNum = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
export const listCycles = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests: no cycles (same as projects)
  const q = parseQuery(req, listQuery.extend({ team_id: uuidSchema.optional() })), cur = q.cursor ? decodeCursor(q.cursor, ctx.workspaceId, "cycles") : null;
  if (cur && !Number.isFinite(Number(cur.k))) throw new ApiError("bad_request", "invalid cursor");
  const today = (await ctx.tx<{ d: string }[]>`select current_date::text as d`)[0]!.d;
  const rows = await ctx.tx<Row[]>`${CSEL(ctx)} where ${teamVisible(ctx, "team_id")}
    ${cur ? ctx.tx`and ((${CYCLE_SK(ctx.tx)}), cycles.id) > (${Number(cur.k)}::int, ${cur.id}::uuid)` : ctx.tx``} ${q.team_id ? ctx.tx`and cycles.team_id = ${q.team_id}` : ctx.tx``}
    order by (${CYCLE_SK(ctx.tx)}), cycles.id limit ${q.limit + 1}`;
  const sk = (r: Row) => String((r.end_date as string) >= today ? dayNum(r.start_date as string, "2000-01-01") : 1000000 + dayNum("2100-01-01", r.start_date as string));
  return Response.json(page(rows, q.limit, ctx.workspaceId, "cycles", (r) => ({ k: sk(r), id: r.id as string })));
});
export const createCycle = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const b = await parseJson(req, cycleBody), id = uuidv7();
  ordered(b.start_date, b.end_date);
  await ctx.tx`insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values (${id}, ${ctx.workspaceId}, ${b.team_id}, ${b.name}, ${b.start_date}, ${b.end_date})`;
  const row = await getCycle(ctx, id);
  await audit(ctx, "cycle", id, "create", diffOf(null, row, CYCLE_F));
  return out(row, 201);
});
export const getCycleH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { requireRole(ctx, "member"); return out(await getCycle(ctx, parseId(rawId))); });
export const patchCycle = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, cycleBody.omit({ team_id: true }).partial());
  const before = await getCycle(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const s = b.start_date ?? (before.start_date as string), e = b.end_date ?? (before.end_date as string);
  ordered(s, e);
  const u = await ctx.tx`update cycles set name = ${b.name ?? (before.name as string)}, start_date = ${s}, end_date = ${e}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getCycle(ctx, id);
  await audit(ctx, "cycle", id, "update", diffOf(before, row, CYCLE_F));
  return out(row);
});
// Note: deleting a cycle does not bump the version of its issues. issues.cycle_id is ON DELETE SET NULL (a DB-side cascade), so the
// row version only moves on app-level updates; the change is still recorded as an activity event per issue. Same for project delete.
export const deleteCycle = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getCycle(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const inCycle = await ctx.tx<Row[]>`select id from issues where cycle_id = ${id} and deleted_at is null`; // issues.cycle_id -> NULL below
  for (const m of inCycle) await audit(ctx, "issue", m.id as string, "update", { cycle_id: { before: id, after: null } });
  await ctx.tx`delete from cycles where id = ${id}`;
  await audit(ctx, "cycle", id, "delete", diffOf(before, null, CYCLE_F));
  return new Response(null, { status: 204 });
});
