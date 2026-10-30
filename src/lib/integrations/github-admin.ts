// Workspace-admin endpoints for the GitHub integration: connect / rotate / disconnect, per-team automation, PR links.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withWorkspaceCtx, requireRole } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId, parseJson, parseQuery } from "../http/validate";
import { uuidv7 } from "../uuid7";
import { audit, assertTeamVisible, teamVisible, type Row } from "../resources/common";

const webhookPath = (id: string) => `/api/v1/integrations/github/webhook/${id}`;
const status = z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]).nullable();

/** GET: connection status for any member (never the secret). */
export const getGithubConnection = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const r = await ctx.tx<Row[]>`select id, created_at, rotated_at from github_connections`;
  if (!r[0]) return Response.json({ connected: false });
  return Response.json({ connected: true, id: r[0].id, webhook_path: webhookPath(r[0].id as string), created_at: r[0].created_at, rotated_at: r[0].rotated_at });
});

/** PUT (admin): connect, or rotate the secret. The secret is returned ONCE, here; it is never readable again. */
export const putGithubConnection = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const secret = randomBytes(32).toString("hex");
  const ex = await ctx.tx<Row[]>`select id from github_connections`;
  let id: string, created = false;
  if (ex[0]) {
    id = ex[0].id as string;
    await ctx.tx`update github_connections set webhook_secret = ${secret}, rotated_at = now() where id = ${id}`;
  } else {
    id = uuidv7(); created = true;
    await ctx.tx`insert into github_connections (id, workspace_id, webhook_secret, created_by) values (${id}, ${ctx.workspaceId}, ${secret}, ${ctx.userId})`;
  }
  await audit(ctx, "github_connection", id, created ? "create" : "rotate_secret", {});
  return Response.json({ id, webhook_path: webhookPath(id), webhook_secret: secret, content_type: "application/json", events: ["pull_request"] }, { status: created ? 201 : 200 });
});

export const deleteGithubConnection = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const ex = await ctx.tx<Row[]>`select id from github_connections`;
  if (!ex[0]) throw new ApiError("not_found");
  await ctx.tx`delete from github_connections where id = ${ex[0].id as string}`;
  await audit(ctx, "github_connection", ex[0].id as string, "delete", {});
  return new Response(null, { status: 204 });
});

const DEFAULTS = { on_pr_open: "in_progress", on_pr_review: "in_review", on_pr_merge: "done" };
export const getTeamGithubSettings = (req: Request, slug: string, teamId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(teamId);
  await assertTeamVisible(ctx, id).catch(() => { throw new ApiError("not_found"); }); // a path id the caller cannot see is a 404, like every team subroute
  const t = await ctx.tx`select 1 from teams where id = ${id}`;
  if (!t[0]) throw new ApiError("not_found");
  const r = await ctx.tx<Row[]>`select on_pr_open, on_pr_review, on_pr_merge from github_team_settings where team_id = ${id}`;
  return Response.json({ team_id: id, ...(r[0] ?? DEFAULTS) });
});

export const putTeamGithubSettings = (req: Request, slug: string, teamId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(teamId);
  const b = await parseJson(req, z.object({ on_pr_open: status, on_pr_review: status, on_pr_merge: status }).partial().strict());
  const t = await ctx.tx`select 1 from teams where id = ${id}`;
  if (!t[0]) throw new ApiError("not_found");
  const before = (await ctx.tx<Row[]>`select on_pr_open, on_pr_review, on_pr_merge from github_team_settings where team_id = ${id}`)[0] ?? DEFAULTS;
  const next = { ...before, ...b } as Record<string, string | null>;
  await ctx.tx`insert into github_team_settings (workspace_id, team_id, on_pr_open, on_pr_review, on_pr_merge)
    values (${ctx.workspaceId}, ${id}, ${next.on_pr_open ?? null}, ${next.on_pr_review ?? null}, ${next.on_pr_merge ?? null})
    on conflict (team_id) do update set on_pr_open = excluded.on_pr_open, on_pr_review = excluded.on_pr_review, on_pr_merge = excluded.on_pr_merge, updated_at = now()`;
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of Object.keys(DEFAULTS)) if ((before as Row)[k] !== next[k]) diff[k] = { before: (before as Row)[k], after: next[k] };
  await audit(ctx, "github_team_settings", id, "update", diff);
  return Response.json({ team_id: id, on_pr_open: next.on_pr_open, on_pr_review: next.on_pr_review, on_pr_merge: next.on_pr_merge });
});

/** GET ?issue_id=: PRs linked to an issue (team-scoped like issues; guests see links of issues shared with them). */
export const listIssuePrLinks = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, z.object({ issue_id: z.string().uuid() }));
  const vis = ctx.role === "guest"
    ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)`
    : teamVisible(ctx, "i.team_id");
  const rows = await ctx.tx<Row[]>`select l.id, l.repo_full_name, l.pr_number, l.url, l.title, l.head_branch, l.state, l.linked_via, l.closes, l.updated_at
    from issue_pr_links l join issues i on i.id = l.issue_id where l.issue_id = ${q.issue_id} and i.deleted_at is null and ${vis}
    order by l.created_at, l.id limit 100`;
  return Response.json({ items: rows, next_cursor: null });
});
