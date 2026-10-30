import { z } from "zod";
import { withWorkspaceCtx, requireRole, atLeast, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, listPage, afterId, assertAssignee, teamVisible } from "./common";
import { computeHealth } from "../project-health";
import { subscribe } from "./subscriptions";
import { emit } from "../notifications";
import { parseMentions, normalizeEmoji, MAX_MENTIONS } from "../comments/mentions";

// ------------------------------------------------ projects (span teams)
const PROJECT_F = ["name", "description", "team_ids", "icon", "color", "lead_id", "status", "start_date", "target_date", "priority", "member_ids"];
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "invalid date");
const projectBody = z.object({ name: z.string().trim().min(1).max(255), description: z.string().max(100000), team_ids: z.array(uuidSchema).max(50),
  icon: z.string().max(64).nullable(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), lead_id: uuidSchema.nullable(),
  status: z.enum(["backlog", "planned", "in_progress", "paused", "completed", "canceled"]),
  start_date: dateStr.nullable(), target_date: dateStr.nullable(), priority: z.number().int().min(0).max(4), member_ids: z.array(uuidSchema).max(200) }).strict();
/** Admins/owners see every project; members see projects sharing a team with them; guests see none. */
export const pvisible = (ctx: Ctx) => atLeast(ctx.role, "admin") ? ctx.tx`true`
  : ctx.role === "guest" ? ctx.tx`false`
  : ctx.tx`exists (select 1 from project_teams pt join team_memberships tm on tm.team_id = pt.team_id and tm.workspace_id = pt.workspace_id
      where pt.project_id = p.id and tm.user_id = ${ctx.userId})`;
/** Counts are per issue VISIBLE to the caller (teamVisible), so a member of team A never learns the size of team B's share of a cross-team project.
 *  issue_count/issues_total = non-canceled, non-deleted; progress_pct = done / issue_count (0 when empty); progress_by_estimate = done estimate / total estimate (null when no estimates).
 *  health = latest posted update (null while the project is planned); health_computed = derived from target_date vs progress (src/lib/project-health.ts). */
const PSEL = (ctx: Ctx) => ctx.tx`select p.id, p.name, p.description, p.icon, p.color, p.lead_id, p.status, p.priority, p.start_date::text as start_date, p.target_date::text as target_date,
  p.version, p.created_at, p.updated_at,
  coalesce((select array_agg(team_id order by team_id) from project_teams where project_id = p.id), '{}') as team_ids,
  coalesce((select array_agg(user_id order by user_id) from project_members where project_id = p.id), '{}') as member_ids,
  st.total as issue_count, st.done as done_count, st.total as issues_total, st.done as issues_done, st.in_progress as issues_in_progress, st.canceled as issues_canceled,
  case when st.total = 0 then 0 else round(100.0 * st.done / st.total)::int end as progress_pct,
  case when st.est_total > 0 then round(100.0 * st.est_done / st.est_total)::int else null end as progress_by_estimate,
  case when p.status = 'planned' then null else (select health from project_updates u where u.project_id = p.id order by u.created_at desc, u.id desc limit 1) end as health from projects p
  cross join lateral (select count(*) filter (where i.status <> 'canceled')::int as total, count(*) filter (where i.status = 'done')::int as done,
      count(*) filter (where i.status in ('in_progress','in_review'))::int as in_progress, count(*) filter (where i.status = 'canceled')::int as canceled,
      coalesce(sum(i.estimate) filter (where i.status <> 'canceled'), 0)::int as est_total, coalesce(sum(i.estimate) filter (where i.status = 'done'), 0)::int as est_done
    from issues i where i.project_id = p.id and i.deleted_at is null and ${teamVisible(ctx, 'i.team_id')}) st`;
const withHealth = (rows: Row[]) => { const t = new Date().toISOString().slice(0, 10); return rows.map((r) => ({ ...r, health_computed: computeHealth(r as never, t) })) as Row[]; };
export const getProject = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id} and ${pvisible(ctx)}`;
  if (!r[0]) throw new ApiError("not_found");
  return withHealth(r)[0]!;
};
async function setMembers(ctx: Ctx, id: string, ids: string[]) {
  for (const u of new Set(ids)) await assertAssignee(ctx, u);
  await ctx.tx`delete from project_members where project_id = ${id}`;
  for (const u of new Set(ids)) await ctx.tx`insert into project_members (workspace_id, project_id, user_id) values (${ctx.workspaceId}, ${id}, ${u})`;
}
async function setTeams(ctx: Ctx, id: string, ids: string[]) {
  await ctx.tx`delete from project_teams where project_id = ${id}`;
  for (const t of new Set(ids)) await ctx.tx`insert into project_teams (workspace_id, project_id, team_id) values (${ctx.workspaceId}, ${id}, ${t})`; // composite FK rejects foreign teams
}
export const listProjects = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, listQuery), c = afterId(ctx, "projects", q);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where ${pvisible(ctx)} ${c ? ctx.tx`and p.id > ${c}::uuid` : ctx.tx``} order by p.id limit ${q.limit + 1}`;
  return listPage(ctx, "projects", q, withHealth(rows));
});
export const createProject = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const b = await parseJson(req, projectBody.partial()), id = uuidv7();
  if (!b.name) throw new ApiError("validation_failed", "name required");
  if (b.lead_id) await assertAssignee(ctx, b.lead_id);
  if (b.start_date && b.target_date && b.target_date < b.start_date) throw new ApiError("validation_failed", "target_date before start_date");
  // Members must put the project in at least one of their own teams (else they could not see what they created); admin+ see everything.
  if (!atLeast(ctx.role, "admin")) {
    const ids = b.team_ids ?? [];
    const mine = ids.length ? await ctx.tx`select 1 from team_memberships where user_id = ${ctx.userId} and team_id in ${ctx.tx(ids)}` : [];
    if (mine.length === 0) throw new ApiError("validation_failed", "team_ids must include one of your teams");
  }
  await ctx.tx`insert into projects (id, workspace_id, name, description, icon, color, lead_id, status, start_date, target_date, priority)
    values (${id}, ${ctx.workspaceId}, ${b.name}, ${b.description ?? ""}, ${b.icon ?? null}, ${b.color ?? null}, ${b.lead_id ?? null}, ${b.status ?? "backlog"}, ${b.start_date ?? null}, ${b.target_date ?? null}, ${b.priority ?? 0})`;
  await setTeams(ctx, id, b.team_ids ?? []);
  await setMembers(ctx, id, b.member_ids ?? []);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id}`; // not via pvisible: a member may create a project for teams they are not in
  await audit(ctx, "project", id, "create", diffOf(null, rows[0]!, PROJECT_F));
  return out(withHealth(rows)[0]!, 201);
});
export const getProjectH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await getProject(ctx, parseId(rawId))));
export const patchProject = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, projectBody.partial());
  if (b.team_ids) requireRole(ctx, "admin"); // changing team scope is admin-only
  const before = await getProject(ctx, id);
  if (b.member_ids && !atLeast(ctx.role, "admin") && before.lead_id !== ctx.userId) throw new ApiError("forbidden"); // P-5: membership is managed by the lead or an admin
  if (Number(before.version) !== want) throw stale(before);
  const pick = <K extends keyof typeof b>(k: K, cur: unknown) => (k in b ? (b[k] ?? null) : cur);
  const lead = pick("lead_id", before.lead_id) as string | null, sd = pick("start_date", before.start_date) as string | null, td = pick("target_date", before.target_date) as string | null;
  if (b.lead_id) await assertAssignee(ctx, b.lead_id);
  if (sd && td && td < sd) throw new ApiError("validation_failed", "target_date before start_date");
  const u = await ctx.tx`update projects set name = ${b.name ?? (before.name as string)}, description = ${b.description ?? (before.description as string)},
    icon = ${pick("icon", before.icon) as string | null}, color = ${pick("color", before.color) as string | null}, lead_id = ${lead},
    status = ${b.status ?? (before.status as string)}, priority = ${b.priority ?? (before.priority as number)}, start_date = ${sd}, target_date = ${td}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  if (b.team_ids) await setTeams(ctx, id, b.team_ids);
  if (b.member_ids) await setMembers(ctx, id, b.member_ids);
  const rows = await ctx.tx<Row[]>`${PSEL(ctx)} where p.id = ${id}`;
  await audit(ctx, "project", id, "update", diffOf(before, rows[0]!, PROJECT_F));
  return out(withHealth(rows)[0]!);
});
// Note: like deleteCycle, issue versions are not bumped (issues.project_id is ON DELETE SET NULL); the change is recorded as activity per issue.
export const deleteProject = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getProject(ctx, id);
  if (Number(before.version) !== want) throw stale(before);
  const inProject = await ctx.tx<Row[]>`select id from issues where project_id = ${id} and deleted_at is null`; // issues.project_id -> NULL below
  for (const m of inProject) await audit(ctx, "issue", m.id as string, "update", { project_id: { before: id, after: null } });
  await ctx.tx`delete from projects where id = ${id}`;
  await audit(ctx, "project", id, "delete", diffOf(before, null, PROJECT_F));
  return new Response(null, { status: 204 });
});

// ------------------------------------------------ comments (on an issue): one level of threads, resolve, reactions, mentions
const COMMENT_F = ["body", "parent_comment_id"];
const commentBody = z.object({ body: z.string().min(1).max(100000), parent_comment_id: uuidSchema.nullable().optional() }).strict();
const editBody = z.object({ body: z.string().min(1).max(100000) }).strict();
const reactionBody = z.object({ emoji: z.string().min(1).max(64) }).strict();
const issueVisible = async (ctx: Ctx, issueId: string) => {
  // Same visibility as the issue itself (shared with a guest / in one of the caller's teams / admin+): a hidden issue hides its comments.
  const r = await ctx.tx`select 1 from issues i where i.id = ${issueId} and i.deleted_at is null and ${ctx.role === "guest"
    ? ctx.tx`exists (select 1 from issue_shares s where s.issue_id = i.id and s.guest_user_id = ${ctx.userId} and s.revoked_at is null)` : teamVisible(ctx, "i.team_id")}`;
  if (!r.length) throw new ApiError("not_found");
};
const CMSEL = (ctx: Ctx) => ctx.tx`select c.id, c.issue_id, c.parent_comment_id, c.author_id, c.body, c.version, c.created_at, c.updated_at,
  c.edited_at, c.resolved_at, c.resolved_by,
  coalesce((select array_agg(m.user_id order by m.user_id) from comment_mentions m where m.comment_id = c.id), '{}') as mention_ids,
  coalesce((select json_agg(json_build_object('emoji', g.emoji, 'count', g.n, 'user_ids', g.u) order by g.first)
    from (select r.emoji, count(*)::int as n, array_agg(r.user_id order by r.created_at) as u, min(r.created_at) as first
      from comment_reactions r where r.comment_id = c.id group by r.emoji) g), '[]') as reactions
  from comments c`;
const getComment = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${CMSEL(ctx)} where c.id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  await issueVisible(ctx, r[0].issue_id as string); // hidden issue => hidden comment
  return r[0];
};
/**
 * Resolve @mentions to workspace members who can SEE the issue (admin+: all; member: a team of the issue; guest: active share).
 * Anyone else is dropped silently (no oracle, and an invisible member must never be subscribed or notified).
 * Ambiguous handles are dropped; unknown ones ignored.
 */
async function resolveMentions(ctx: Ctx, issueId: string, body: string): Promise<string[]> {
  const { ids, handles } = parseMentions(body);
  const found = new Set<string>();
  const t = ctx.tx;
  const sees = t`(m.role in ('owner','admin')
    or (m.role = 'guest' and exists (select 1 from issue_shares s where s.issue_id = ${issueId} and s.guest_user_id = m.user_id and s.revoked_at is null))
    or (m.role = 'member' and exists (select 1 from issues i join team_memberships tm on tm.team_id = i.team_id and tm.workspace_id = i.workspace_id
        where i.id = ${issueId} and i.deleted_at is null and tm.user_id = m.user_id)))`;
  if (ids.length) for (const r of await t`select m.user_id from memberships m where m.user_id in ${t(ids)} and ${sees}`) found.add(r.user_id as string);
  if (handles.length) {
    const rows = await t`select split_part(lower(u.email), '@', 1) as h, array_agg(u.id) as ids from memberships m join users u on u.id = m.user_id
      where split_part(lower(u.email), '@', 1) in ${t(handles)} and ${sees} group by 1`;
    for (const r of rows) if ((r.ids as string[]).length === 1) found.add((r.ids as string[])[0]!);
  }
  found.delete(ctx.userId); // self-mention is a no-op
  return [...found].slice(0, MAX_MENTIONS);
}
/** Stores the comment's mentions and subscribes them. Returns all mentioned ids and the ones added by this call. */
async function syncMentions(ctx: Ctx, commentId: string, issueId: string, body: string) {
  const ids = await resolveMentions(ctx, issueId, body);
  const prev = new Set((await ctx.tx`select user_id from comment_mentions where comment_id = ${commentId}`).map((r) => r.user_id as string));
  await ctx.tx`delete from comment_mentions where comment_id = ${commentId} ${ids.length ? ctx.tx`and user_id not in ${ctx.tx(ids)}` : ctx.tx``}`;
  for (const u of ids) await ctx.tx`insert into comment_mentions (workspace_id, comment_id, user_id) values (${ctx.workspaceId}, ${commentId}, ${u}) on conflict do nothing`;
  await subscribe(ctx, issueId, ids, "mention");
  return { ids, added: ids.filter((u) => !prev.has(u)) };
}
export const listComments = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const issueId = parseId(rawIssue), q = parseQuery(req, listQuery), scope = `comments:${issueId}`, c = afterId(ctx, scope, q);
  await issueVisible(ctx, issueId);
  // Flat, creation-ordered list; clients nest replies under parent_comment_id (one level).
  const rows = await ctx.tx<Row[]>`${CMSEL(ctx)} where c.issue_id = ${issueId} ${c ? ctx.tx`and c.id > ${c}::uuid` : ctx.tx``} order by c.id limit ${q.limit + 1}`;
  return listPage(ctx, scope, q, rows);
});
export const createComment = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member"); // guests are read-only
  const issueId = parseId(rawIssue), b = await parseJson(req, commentBody), id = uuidv7(), parent = b.parent_comment_id ?? null;
  await issueVisible(ctx, issueId);
  if (parent) {
    const p = await ctx.tx`select issue_id, parent_comment_id from comments where id = ${parent}`;
    if (!p[0] || p[0].issue_id !== issueId) throw new ApiError("validation_failed", "invalid parent_comment_id");
    if (p[0].parent_comment_id) throw new ApiError("validation_failed", "comment threads are one level deep");
  }
  await ctx.tx`insert into comments (id, workspace_id, issue_id, parent_comment_id, author_id, body) values (${id}, ${ctx.workspaceId}, ${issueId}, ${parent}, ${ctx.userId}, ${b.body})`;
  if (parent) await ctx.tx`update comments set resolved_at = null, resolved_by = null where id = ${parent} and resolved_at is not null`; // a reply reopens the thread
  await subscribe(ctx, issueId, [ctx.userId], "commenter");
  const { ids: mentioned } = await syncMentions(ctx, id, issueId, b.body);
  const row = await getComment(ctx, id);
  await audit(ctx, "comment", id, "create", { ...diffOf(null, row, COMMENT_F), issue_id: { before: null, after: issueId },
    ...(mentioned.length ? { mention_ids: { before: [], after: mentioned } } : {}) });
  await emit(ctx, { kind: "comment_created", issueId, commentId: id, mentioned, parentCommentId: parent });
  return out(row, 201);
});
export const getCommentH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => out(await getComment(ctx, parseId(rawId))));
export const patchComment = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, editBody);
  const before = await getComment(ctx, id);
  if (before.author_id !== ctx.userId) throw new ApiError("forbidden"); // only the author edits
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update comments set body = ${b.body}, version = version + 1, updated_at = now(), edited_at = now() where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const { added } = await syncMentions(ctx, id, before.issue_id as string, b.body);
  const row = await getComment(ctx, id);
  await audit(ctx, "comment", id, "update", diffOf(before, row, ["body"]));
  await emit(ctx, { kind: "comment_updated", issueId: before.issue_id as string, commentId: id, mentioned: added });
  return out(row);
});
export const deleteComment = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getComment(ctx, id);
  if (before.author_id !== ctx.userId && !atLeast(ctx.role, "admin")) throw new ApiError("forbidden"); // author or admin
  if (Number(before.version) !== want) throw stale(before);
  const replies = await ctx.tx`select id from comments where parent_comment_id = ${id}`;
  await ctx.tx`delete from comments where id = ${id}`; // replies, reactions, mentions cascade
  await audit(ctx, "comment", id, "delete", { ...diffOf(before, null, COMMENT_F), ...(replies.length ? { reply_ids: { before: replies.map((r) => r.id), after: [] } } : {}) });
  return new Response(null, { status: 204 });
});
/** Resolve / reopen a thread (root comments only). Any member; idempotent; no If-Match (state toggle). */
const setResolved = (resolved: boolean) => (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), before = await getComment(ctx, id);
  if (before.parent_comment_id) throw new ApiError("validation_failed", "only a thread root can be resolved");
  if (resolved === (before.resolved_at !== null)) return out(before);
  if (resolved) await ctx.tx`update comments set resolved_at = now(), resolved_by = ${ctx.userId}, version = version + 1 where id = ${id}`;
  else await ctx.tx`update comments set resolved_at = null, resolved_by = null, version = version + 1 where id = ${id}`;
  const row = await getComment(ctx, id);
  await audit(ctx, "comment", id, resolved ? "resolve" : "unresolve", { resolved_at: { before: before.resolved_at, after: row.resolved_at } });
  return out(row);
});
export const resolveComment = setResolved(true);
export const unresolveComment = setResolved(false);

// ------------------------------------------------ reactions (one per user per emoji)
const RSEL = (ctx: Ctx) => ctx.tx`select id, comment_id, user_id, emoji, created_at from comment_reactions`;
export const listReactions = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId);
  await getComment(ctx, id);
  const items = await ctx.tx<Row[]>`${RSEL(ctx)} where comment_id = ${id} order by created_at, id`;
  return Response.json({ items });
});
export const addReaction = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), b = await parseJson(req, reactionBody), emoji = normalizeEmoji(b.emoji);
  if (!emoji) throw new ApiError("validation_failed", "invalid emoji");
  await getComment(ctx, id);
  const ins = await ctx.tx<Row[]>`insert into comment_reactions (id, workspace_id, comment_id, user_id, emoji) values (${uuidv7()}, ${ctx.workspaceId}, ${id}, ${ctx.userId}, ${emoji})
    on conflict (comment_id, user_id, emoji) do nothing returning id, comment_id, user_id, emoji, created_at`;
  if (!ins[0]) { // idempotent: already reacted
    const ex = await ctx.tx<Row[]>`${RSEL(ctx)} where comment_id = ${id} and user_id = ${ctx.userId} and emoji = ${emoji}`;
    return Response.json(ex[0], { status: 200 });
  }
  await audit(ctx, "comment_reaction", ins[0].id as string, "create", { comment_id: { before: null, after: id }, emoji: { before: null, after: emoji } });
  return Response.json(ins[0], { status: 201 });
});
/** Removes the caller's own reaction; emoji from ?emoji= or the JSON body. */
export const removeReaction = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const id = parseId(rawId), qe = new URL(req.url).searchParams.get("emoji");
  const emoji = normalizeEmoji(qe ?? (await parseJson(req, reactionBody)).emoji);
  if (!emoji) throw new ApiError("validation_failed", "invalid emoji");
  await getComment(ctx, id);
  const d = await ctx.tx<Row[]>`delete from comment_reactions where comment_id = ${id} and user_id = ${ctx.userId} and emoji = ${emoji} returning id`;
  if (!d[0]) throw new ApiError("not_found");
  await audit(ctx, "comment_reaction", d[0].id as string, "delete", { comment_id: { before: id, after: null }, emoji: { before: emoji, after: null } });
  return new Response(null, { status: 204 });
});
