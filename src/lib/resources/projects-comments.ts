import { z } from "zod";
import { withWorkspaceCtx, requireRole, atLeast, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId } from "./common";

// ------------------------------------------------ projects (span teams)
const PROJECT_F = ["name", "description", "team_ids"];
const projectBody = z.object({ name: z.string().trim().min(1).max(255), description: z.string().max(100000), team_ids: z.array(uuidSchema).max(50) }).strict();
/** Admins/owners see every project; members see projects sharing a team with them; guests see none. */
const pvisible = (ctx: Ctx) => atLeast(ctx.role, "admin") ? ctx.tx`true`
  : ctx.role === "guest" ? ctx.tx`false`
  : ctx.tx`exists (select 1 from project_teams pt join team_memberships tm on tm.team_id = pt.team_id and tm.workspace_id = pt.workspace_id
      where pt.project_id = p.id and tm.user_id = ${ctx.userId})`;
const PSEL = (ctx: Ctx) => ctx.tx`select p.id, p.name, p.description, p.version, p.created_at, p.updated_at,
  coalesce((select array_agg(team_id order by team_id) from project_teams where project_id = p.id), '{}') as team_ids from projects p`;
const getProject = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id} and ${pvisible(ctx)}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
async function setTeams(ctx: Ctx, id: string, ids: string[]) {
  await ctx.tx`delete from project_teams where project_id = ${id}`;
  for (const t of new Set(ids)) await ctx.tx`insert into project_teams (workspace_id, project_id, team_id) values (${ctx.workspaceId}, ${id}, ${t})`; // composite FK rejects foreign teams
}
export const listProjects = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, listQuery), c = afterId(ctx, "projects", q);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where ${pvisible(ctx)} ${c ? ctx.tx`and p.id > ${c}::uuid` : ctx.tx``} order by p.id limit ${q.limit + 1}`;
  return listPage(ctx, "projects", q, rows);
});
export const createProject = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, projectBody.partial({ description: true, team_ids: true })), id = uuidv7();
  await ctx.tx`insert into projects (id, workspace_id, name, description) values (${id}, ${ctx.workspaceId}, ${b.name}, ${b.description ?? ""})`;
  await setTeams(ctx, id, b.team_ids ?? []);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id}`; // not via pvisible: a member may create a project for teams they are not in
  await audit(ctx, "project", id, "create", diffOf(null, rows[0]!, PROJECT_F));
  return out(rows[0]!, 201);
});
export const getProjectH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await getProject(ctx, parseId(rawId))));
export const patchProject = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, projectBody.partial());
  const before = await getProject(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update projects set name = ${b.name ?? (before.name as string)}, description = ${b.description ?? (before.description as string)}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  if (b.team_ids) await setTeams(ctx, id, b.team_ids);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id}`;
  await audit(ctx, "project", id, "update", diffOf(before, rows[0]!, PROJECT_F));
  return out(rows[0]!);
});
export const deleteProject = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getProject(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from projects where id = ${id}`; // issues.project_id -> NULL
  await audit(ctx, "project", id, "delete", diffOf(before, null, PROJECT_F));
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ comments (on an issue)
const COMMENT_F = ["body"];
const commentBody = z.object({ body: z.string().min(1).max(100000) }).strict();
const issueVisible = async (ctx: Ctx, issueId: string) => {
  const r = await ctx.tx`select 1 from issues i where i.id = ${issueId} and i.deleted_at is null and ${ctx.role === "guest"
    ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)` : ctx.tx`true`}`;
  if (!r.length) throw new ApiError("not_found");
};
const CMSEL = (ctx: Ctx) => ctx.tx`select id, issue_id, author_id, body, version, created_at, updated_at from comments`;
const getComment = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${CMSEL(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  await issueVisible(ctx, r[0].issue_id as string); // hidden issue => hidden comment
  return r[0];
};
export const listComments = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const issueId = parseId(rawIssue), q = parseQuery(req, listQuery), scope = `comments:${issueId}`, c = afterId(ctx, scope, q);
  await issueVisible(ctx, issueId);
  const rows = await ctx.tx<Row[]>`${CMSEL(ctx)} where issue_id = ${issueId} ${c ? ctx.tx`and id > ${c}::uuid` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, scope, q, rows);
});
export const createComment = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests are read-only
  const issueId = parseId(rawIssue), b = await parseJson(req, commentBody), id = uuidv7();
  await issueVisible(ctx, issueId);
  await ctx.tx`insert into comments (id, workspace_id, issue_id, author_id, body) values (${id}, ${ctx.workspaceId}, ${issueId}, ${ctx.userId}, ${b.body})`;
  const row = await getComment(ctx, id);
  await audit(ctx, "comment", id, "create", { ...diffOf(null, row, COMMENT_F), issue_id: { before: null, after: issueId } });
  return out(row, 201);
});
export const getCommentH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await getComment(ctx, parseId(rawId))));
export const patchComment = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, commentBody);
  const before = await getComment(ctx, id);
  if (before.author_id !== ctx.userId) throw new ApiError("forbidden"); // only the author edits
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update comments set body = ${b.body}, version = version + 1, updated_at = now() where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getComment(ctx, id);
  await audit(ctx, "comment", id, "update", diffOf(before, row, COMMENT_F));
  return out(row);
});
export const deleteComment = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getComment(ctx, id);
  if (before.author_id !== ctx.userId && !atLeast(ctx.role, "admin")) throw new ApiError("forbidden"); // author or admin
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from comments where id = ${id}`;
  await audit(ctx, "comment", id, "delete", diffOf(before, null, COMMENT_F));
  return new Response(null, { status: 204 });
});
