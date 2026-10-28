import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId, assertTeamVisible } from "./common";

// Issue templates, per team. Read: any member who can see the team. Write: workspace admins/owners.
const F = ["name", "title", "description", "priority", "label_ids"];
const body = z.object({
  name: z.string().trim().min(1).max(80), title: z.string().max(255).default(""), description: z.string().max(100000).default(""),
  priority: z.number().int().min(0).max(4).default(0), label_ids: z.array(uuidSchema).max(50).default([]),
}).strict();
const SEL = (ctx: Ctx) => ctx.tx`select id, team_id, name, title, description, priority, label_ids, version, created_at, updated_at from issue_templates`;

export const getTemplateRow = async (ctx: Ctx, teamId: string, id: string) => {
  const r = await ctx.tx<Row[]>`${SEL(ctx)} where id = ${id} and team_id = ${teamId}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
const assertLabels = async (ctx: Ctx, ids: string[]) => {
  if (!ids.length) return;
  const n = (await ctx.tx<{ n: number }[]>`select count(*)::int n from labels where id = any(${ids}::uuid[])`)[0]!.n;
  if (n !== new Set(ids).size) throw new ApiError("validation_failed", "unknown label");
};
const team = async (ctx: Ctx, rawTeam: string) => {
  const id = parseId(rawTeam);
  await assertTeamVisible(ctx, id).catch(() => { throw new ApiError("not_found"); });
  if (!(await ctx.tx`select 1 from teams where id = ${id}`).length) throw new ApiError("not_found"); // unknown team, admins included
  return id;
};
const dup = (e: unknown) => { if ((e as { code?: string }).code === "23505") throw new ApiError("conflict", "template name already used in this team"); throw e; };

export const listTemplates = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const teamId = await team(ctx, rawTeam);
  const q = parseQuery(req, listQuery), c = afterId(ctx, "templates", q);
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where team_id = ${teamId} and ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "templates", q, rows);
});
export const getTemplate = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  return out(await getTemplateRow(ctx, await team(ctx, rawTeam), parseId(rawId)));
});
export const createTemplate = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam), b = await parseJson(req, body), id = uuidv7();
  await assertLabels(ctx, b.label_ids);
  await ctx.tx`insert into issue_templates (id, workspace_id, team_id, name, title, description, priority, label_ids, created_by)
    values (${id}, ${ctx.workspaceId}, ${teamId}, ${b.name}, ${b.title}, ${b.description}, ${b.priority}, ${b.label_ids}::uuid[], ${ctx.userId})`.catch(dup);
  const row = await getTemplateRow(ctx, teamId, id);
  await audit(ctx, "issue_template", id, "create", diffOf(null, row, F));
  return out(row, 201);
});
export const patchTemplate = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam), id = parseId(rawId), want = ifMatchVersion(req);
  const b = await parseJson(req, body.partial().extend({ title: z.string().max(255).optional(), description: z.string().max(100000).optional(), priority: z.number().int().min(0).max(4).optional(), label_ids: z.array(uuidSchema).max(50).optional() }));
  const before = await getTemplateRow(ctx, teamId, id);
  if (Number(before.version) !== want) throw stale(before);
  if (b.label_ids) await assertLabels(ctx, b.label_ids);
  const v = <K extends keyof typeof b>(k: K) => (b[k] !== undefined ? b[k] : before[k as string]);
  const u = await ctx.tx`update issue_templates set name = ${v("name") as string}, title = ${v("title") as string}, description = ${v("description") as string},
    priority = ${v("priority") as number}, label_ids = ${v("label_ids") as string[]}::uuid[], version = version + 1, updated_at = now()
    where id = ${id} and team_id = ${teamId} and version = ${want} returning id`.catch(dup);
  if (!u.length) throw stale(before);
  const after = await getTemplateRow(ctx, teamId, id);
  await audit(ctx, "issue_template", id, "update", diffOf(before, after, F));
  return out(after);
});
export const deleteTemplate = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam), id = parseId(rawId);
  const d = await ctx.tx`delete from issue_templates where id = ${id} and team_id = ${teamId} returning name`;
  if (!d.length) throw new ApiError("not_found");
  await audit(ctx, "issue_template", id, "delete", { name: { before: d[0]!.name, after: null } });
  return new Response(null, { status: 204 });
});
