import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId } from "./common";

// ------------------------------------------------ labels (workspace-wide)
const LABEL_F = ["name", "color"];
const labelBody = z.object({ name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();
const LSEL = (ctx: Ctx) => ctx.tx`select id, name, color, version, created_at, updated_at from labels`;
const getLabel = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${LSEL(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
export const listLabels = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests: no labels (same as projects)
  const q = parseQuery(req, listQuery), c = afterId(ctx, "labels", q);
  const rows = await ctx.tx<Row[]>`${LSEL(ctx)} where ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "labels", q, rows);
});
export const createLabel = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, labelBody.partial({ color: true })), id = uuidv7();
  await ctx.tx`insert into labels (id, workspace_id, name, color) values (${id}, ${ctx.workspaceId}, ${b.name}, ${b.color ?? "#888888"})`;
  const row = await getLabel(ctx, id);
  await audit(ctx, "label", id, "create", diffOf(null, row, LABEL_F));
  return out(row, 201);
});
export const getLabelH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { requireRole(ctx, "member"); return out(await getLabel(ctx, parseId(rawId))); });
export const patchLabel = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, labelBody.partial());
  const before = await getLabel(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update labels set name = ${b.name ?? (before.name as string)}, color = ${b.color ?? (before.color as string)}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getLabel(ctx, id);
  await audit(ctx, "label", id, "update", diffOf(before, row, LABEL_F));
  return out(row);
});
export const deleteLabel = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getLabel(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from labels where id = ${id}`; // issue_labels rows cascade
  await audit(ctx, "label", id, "delete", diffOf(before, null, LABEL_F));
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ cycles (per team, no overlap within a team)
const CYCLE_F = ["team_id", "name", "start_date", "end_date"];
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), "invalid date");
const cycleBody = z.object({ team_id: uuidSchema, name: z.string().trim().min(1).max(255), start_date: date, end_date: date }).strict();
const CSEL = (ctx: Ctx) => ctx.tx`select id, team_id, name, start_date::text as start_date, end_date::text as end_date, version, created_at, updated_at from cycles`;
const getCycle = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${CSEL(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
const ordered = (s: string, e: string) => { if (e < s) throw new ApiError("validation_failed", "end_date before start_date"); };
export const listCycles = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests: no cycles (same as projects)
  const q = parseQuery(req, listQuery.extend({ team_id: uuidSchema.optional() })), c = afterId(ctx, "cycles", q);
  const rows = await ctx.tx<Row[]>`${CSEL(ctx)} where ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} ${q.team_id ? ctx.tx`and team_id = ${q.team_id}` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "cycles", q, rows);
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
export const deleteCycle = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getCycle(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from cycles where id = ${id}`; // issues.cycle_id -> NULL
  await audit(ctx, "cycle", id, "delete", diffOf(before, null, CYCLE_F));
  return new Response(null, { status: 204 });
});
