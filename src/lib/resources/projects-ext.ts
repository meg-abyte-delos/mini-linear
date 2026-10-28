import { z } from "zod";
import { withWorkspaceCtx, requireRole, atLeast, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId } from "./common";
import { getProject } from "./projects-comments";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "invalid date");

// ------------------------------------------------ milestones (on a project)
const MS_F = ["name", "description", "target_date", "sort_order"];
const msBody = z.object({ name: z.string().trim().min(1).max(255), description: z.string().max(100000), target_date: dateStr.nullable(), sort_order: z.number().int().min(-1000000).max(1000000) }).strict();
const MSSEL = (ctx: Ctx) => ctx.tx`select m.id, m.project_id, m.name, m.description, m.target_date::text as target_date, m.sort_order, m.version, m.created_at, m.updated_at,
  (select count(*)::int from issues i where i.project_id = m.project_id and i.deleted_at is null and i.status <> 'canceled') as project_issue_count from project_milestones m`;
const getMs = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${MSSEL(ctx)} where m.id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  await getProject(ctx, r[0].project_id as string); // hidden project => hidden milestone
  return r[0];
};
export const listMilestones = (req: Request, slug: string, rawProject: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const pid = parseId(rawProject), q = parseQuery(req, listQuery), scope = `milestones:${pid}`, c = afterId(ctx, scope, q);
  await getProject(ctx, pid);
  const rows = await ctx.tx<Row[]>`${MSSEL(ctx)} where m.project_id = ${pid} ${c ? ctx.tx`and m.id > ${c}::uuid` : ctx.tx``} order by m.id limit ${q.limit + 1}`;
  return listPage(ctx, scope, q, rows);
});
export const createMilestone = (req: Request, slug: string, rawProject: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const pid = parseId(rawProject), b = await parseJson(req, msBody.partial({ description: true, target_date: true, sort_order: true })), id = uuidv7();
  if (!b.name) throw new ApiError("validation_failed", "name required");
  await getProject(ctx, pid);
  await ctx.tx`insert into project_milestones (id, workspace_id, project_id, name, description, target_date, sort_order)
    values (${id}, ${ctx.workspaceId}, ${pid}, ${b.name}, ${b.description ?? ""}, ${b.target_date ?? null}, ${b.sort_order ?? 0})`;
  const row = await getMs(ctx, id);
  await audit(ctx, "project_milestone", id, "create", { ...diffOf(null, row, MS_F), project_id: { before: null, after: pid } });
  return out(row, 201);
});
export const getMilestoneH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await getMs(ctx, parseId(rawId))));
export const patchMilestone = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, msBody.partial()), before = await getMs(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const td = "target_date" in b ? (b.target_date ?? null) : (before.target_date as string | null);
  const u = await ctx.tx`update project_milestones set name = ${b.name ?? (before.name as string)}, description = ${b.description ?? (before.description as string)},
    target_date = ${td}, sort_order = ${b.sort_order ?? (before.sort_order as number)}, version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getMs(ctx, id);
  await audit(ctx, "project_milestone", id, "update", diffOf(before, row, MS_F));
  return out(row);
});
export const deleteMilestone = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getMs(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from project_milestones where id = ${id}`;
  await audit(ctx, "project_milestone", id, "delete", diffOf(before, null, MS_F));
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ project updates (health posts)
const UP_F = ["health", "body"];
const upBody = z.object({ health: z.enum(["on_track", "at_risk", "off_track"]), body: z.string().max(100000) }).strict();
const UPSEL = (ctx: Ctx) => ctx.tx`select id, project_id, author_id, health, body, version, created_at, updated_at from project_updates`;
const getUp = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${UPSEL(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  await getProject(ctx, r[0].project_id as string);
  return r[0];
};
export const listUpdates = (req: Request, slug: string, rawProject: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const pid = parseId(rawProject), q = parseQuery(req, listQuery), scope = `pupdates:${pid}`, c = afterId(ctx, scope, q);
  await getProject(ctx, pid);
  const rows = await ctx.tx<Row[]>`${UPSEL(ctx)} where project_id = ${pid} ${c ? ctx.tx`and id > ${c}::uuid` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, scope, q, rows);
});
export const createUpdate = (req: Request, slug: string, rawProject: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const pid = parseId(rawProject), b = await parseJson(req, upBody.partial({ body: true })), id = uuidv7();
  if (!b.health) throw new ApiError("validation_failed", "health required");
  await getProject(ctx, pid);
  await ctx.tx`insert into project_updates (id, workspace_id, project_id, author_id, health, body) values (${id}, ${ctx.workspaceId}, ${pid}, ${ctx.userId}, ${b.health}, ${b.body ?? ""})`;
  const row = await getUp(ctx, id);
  await audit(ctx, "project_update", id, "create", { ...diffOf(null, row, UP_F), project_id: { before: null, after: pid } });
  return out(row, 201);
});
export const patchUpdate = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, upBody.partial()), before = await getUp(ctx, id);
  if (before.author_id !== ctx.userId) throw new ApiError("forbidden");
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update project_updates set health = ${b.health ?? (before.health as string)}, body = ${b.body ?? (before.body as string)}, version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getUp(ctx, id);
  await audit(ctx, "project_update", id, "update", diffOf(before, row, UP_F));
  return out(row);
});
export const deleteUpdate = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getUp(ctx, id);
  if (before.author_id !== ctx.userId && !atLeast(ctx.role, "admin")) throw new ApiError("forbidden");
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from project_updates where id = ${id}`;
  await audit(ctx, "project_update", id, "delete", diffOf(before, null, UP_F));
  return new Response(null, { status: 204 });
});
