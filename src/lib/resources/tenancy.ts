import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withUser, withWorkspaceCtx, requireRole, type Role } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId, parseJson, parseQuery, listQuery } from "../http/validate";
import { uuidv7 } from "../uuid7";
import { recordAudit } from "../audit";
import { hashToken, newToken } from "../auth/tokens";
import { sendMail } from "../auth/mail";
import { type Row, audit, listPage, afterId } from "./common";

const emailS = z.string().trim().toLowerCase().email().max(254);
const slugS = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/);
const nameS = z.string().trim().min(1).max(100);
const INVITE_DAYS = 7;

// ---------------------------------------------------------------- workspaces
export const listWorkspaces = (req: Request) => withUser(req, async (tx, userId) => {
  const items = await tx<Row[]>`select id, slug, name, role from list_my_workspaces(${userId})`;
  return Response.json({ items, next_cursor: null });
});

export const createWorkspace = (req: Request) => withUser(req, async (tx, userId) => {
  const b = await parseJson(req, z.object({ slug: slugS, name: nameS }).strict());
  const id = uuidv7();
  // Rex nit: workspaces is INSERT-only for app_user and FORCE RLS applies, so set the tenant first and insert WITHOUT RETURNING.
  await tx`select set_config('app.workspace_id', ${id}, true)`;
  await tx`insert into workspaces (id, slug, name) values (${id}, ${b.slug}, ${b.name})`;
  await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${id}, ${userId}, 'owner')`;
  await recordAudit(tx, { workspaceId: id, actorId: userId, entity: "workspace", entityId: id, action: "create", diff: { slug: { before: null, after: b.slug }, name: { before: null, after: b.name } } });
  return Response.json({ id, slug: b.slug, name: b.name, role: "owner" }, { status: 201 });
});

export const getWorkspace = (req: Request, slug: string) => withUser(req, async (tx, userId) => {
  const r = await tx<Row[]>`select id, slug, name, role from list_my_workspaces(${userId}) where slug = ${slug}`;
  if (!r[0]) throw new ApiError("not_found"); // non-member -> 404
  return Response.json(r[0]);
});

// ---------------------------------------------------------------- members
const ROLES = ["owner", "admin", "member", "guest"] as const;
/** Who may grant/touch which role: owners anything; admins only member/guest (and never an owner or admin). */
function mayManage(actor: Role, target: Role, newRole?: Role) {
  if (actor === "owner") return true;
  if (actor !== "admin") return false;
  return (target === "member" || target === "guest") && (newRole === undefined || newRole === "member" || newRole === "guest");
}
const roleOf = async (tx: Parameters<Parameters<typeof withWorkspaceCtx>[2]>[0]["tx"], uid: string) => {
  const r = await tx<{ role: Role }[]>`select role from memberships where user_id = ${uid}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0].role;
};
const lastOwner = async (tx: Parameters<Parameters<typeof withWorkspaceCtx>[2]>[0]["tx"]) => (await tx`select 1 from memberships where role = 'owner' for update`).length < 2;

export const listMembers = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const q = parseQuery(req, listQuery), c = afterId(ctx, "members", q);
  const rows = await ctx.tx<Row[]>`select m.id, m.user_id, u.email, m.role, m.created_at from memberships m join users u on u.id = m.user_id
    where ${c ? ctx.tx`m.id > ${c}::uuid` : ctx.tx`true`} order by m.id limit ${q.limit + 1}`;
  return listPage(ctx, "members", q, rows);
});

export const patchMember = (req: Request, slug: string, rawUid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const uid = parseId(rawUid), b = await parseJson(req, z.object({ role: z.enum(ROLES) }).strict());
  const cur = await roleOf(ctx.tx, uid);
  if (!mayManage(ctx.role, cur, b.role)) throw new ApiError("forbidden");
  if (cur === "owner" && b.role !== "owner" && (await lastOwner(ctx.tx))) throw new ApiError("conflict", "cannot demote the last owner");
  await ctx.tx`update memberships set role = ${b.role} where user_id = ${uid}`;
  await audit(ctx, "member", uid, "update", { role: { before: cur, after: b.role } });
  return Response.json({ user_id: uid, role: b.role });
});

/** Remove a member; any member may remove themselves (leave) unless last owner. */
export const deleteMember = (req: Request, slug: string, rawUid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const uid = parseId(rawUid), cur = await roleOf(ctx.tx, uid);
  if (uid !== ctx.userId) { requireRole(ctx, "admin"); if (!mayManage(ctx.role, cur)) throw new ApiError("forbidden"); }
  if (cur === "owner" && (await lastOwner(ctx.tx))) throw new ApiError("conflict", "cannot remove the last owner");
  await ctx.tx`delete from team_memberships where user_id = ${uid}`;
  await ctx.tx`delete from memberships where user_id = ${uid}`;
  await audit(ctx, "member", uid, "delete", { role: { before: cur, after: null } });
  return new Response(null, { status: 204 });
});

// ---------------------------------------------------------------- invites
export const listInvites = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const q = parseQuery(req, listQuery), c = afterId(ctx, "invites", q);
  const rows = await ctx.tx<Row[]>`select id, email, role, invited_by, expires_at, created_at from invites
    where used_at is null and revoked_at is null and expires_at > now() and ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "invites", q, rows);
});

export const createInvite = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const b = await parseJson(req, z.object({ email: emailS, role: z.enum(["admin", "member", "guest"]) }).strict());
  if (ctx.role === "admin" && b.role === "admin") throw new ApiError("forbidden", "only owners invite admins");
  // One pending invite per email: re-inviting revokes the previous token, so only the newest mail link works.
  await ctx.tx`update invites set revoked_at = now() where lower(email) = ${b.email} and used_at is null and revoked_at is null`;
  const id = uuidv7(), t = newToken();
  await ctx.tx`insert into invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) values (${id}, ${ctx.workspaceId}, ${b.email}, ${b.role}, ${hashToken(t)}, ${ctx.userId}, ${new Date(Date.now() + INVITE_DAYS * 86400_000)})`;
  await audit(ctx, "invite", id, "create", { email: { before: null, after: b.email }, role: { before: null, after: b.role } });
  await sendMail({ to: b.email, kind: "invite", token: t }); // token only travels by mail, never in the response
  return Response.json({ id, email: b.email, role: b.role }, { status: 201 });
});

/** Resend: rotates the token (the old link dies) and restarts the expiry window. Never returns the token. */
export const resendInvite = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId);
  const cur = (await ctx.tx<{ role: Role }[]>`select role from invites where id = ${id} and used_at is null and revoked_at is null`)[0];
  if (!cur) throw new ApiError("not_found");
  if (ctx.role === "admin" && cur.role === "admin") throw new ApiError("forbidden", "only owners invite admins");
  const t = newToken();
  const r = await ctx.tx<{ email: string; role: Role }[]>`update invites set token_hash = ${hashToken(t)}, expires_at = ${new Date(Date.now() + INVITE_DAYS * 86400_000)}
    where id = ${id} and used_at is null and revoked_at is null returning email, role`;
  if (!r.length) throw new ApiError("not_found");
  await audit(ctx, "invite", id, "resend", {});
  await sendMail({ to: r[0]!.email, kind: "invite", token: t });
  return Response.json({ id, email: r[0]!.email, role: r[0]!.role });
});

export const deleteInvite = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId);
  // Soft revoke (#51): the row stays for the audit trail; lookup_invite ignores it, so the token is dead.
  const d = await ctx.tx`update invites set revoked_at = now() where id = ${id} and used_at is null and revoked_at is null returning email`;
  if (!d.length) throw new ApiError("not_found");
  await audit(ctx, "invite", id, "revoke", { email: { before: d[0]!.email, after: null } });
  return new Response(null, { status: 204 });
});

/** Accept: signed-in user whose (lowercased) email equals the invite's. Same 404 for unknown/expired/used/mismatched, so tokens leak nothing. */
export const acceptInvite = (req: Request) => withUser(req, async (tx, userId) => {
  // Malformed tokens (too short/long, wrong type) must look exactly like unknown ones: same 404, no validation oracle.
  const parsed = await parseJson(req, z.object({ token: z.unknown() }).passthrough()).catch(() => ({ token: undefined as unknown }));
  const token = typeof parsed.token === "string" && parsed.token.length >= 20 && parsed.token.length <= 200 ? parsed.token : null;
  if (token === null) throw new ApiError("INVITE_INVALID", "invalid invite");
  const inv = (await tx<{ workspace_id: string; email: string }[]>`select * from lookup_invite(${hashToken(token)})`)[0];
  const u = (await tx<{ email: string; email_verified_at: Date | null }[]>`select email, email_verified_at from users where id = ${userId}`)[0];
  if (!inv || !u || !u.email_verified_at || u.email.toLowerCase() !== inv.email.toLowerCase()) throw new ApiError("INVITE_INVALID", "invalid invite");
  await tx`select set_config('app.workspace_id', ${inv.workspace_id}, true)`;
  // id and role are read under RLS, not via the definer function (#56)
  const used = await tx<{ id: string; role: Role }[]>`update invites set used_at = now() where token_hash = ${hashToken(token)} and used_at is null and revoked_at is null and expires_at > now() returning id, role`;
  if (!used.length) throw new ApiError("INVITE_INVALID", "invalid invite");
  const role = used[0]!.role;
  const ins = await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${inv.workspace_id}, ${userId}, ${role}) on conflict (workspace_id, user_id) do nothing returning id`;
  if (!ins.length) throw new ApiError("conflict", "already a member");
  await recordAudit(tx, { workspaceId: inv.workspace_id, actorId: userId, entity: "invite", entityId: used[0]!.id, action: "invite_accept", diff: { used: { before: false, after: true } } });
  await recordAudit(tx, { workspaceId: inv.workspace_id, actorId: userId, entity: "member", entityId: userId, action: "create", diff: { role: { before: null, after: role } } });
  const ws = (await tx<Row[]>`select id, slug, name, role from list_my_workspaces(${userId}) where id = ${inv.workspace_id}`)[0];
  return Response.json(ws ?? { id: inv.workspace_id, role });
});

// ---------------------------------------------------------------- teams
const keyS = z.string().regex(/^[A-Z]{2,5}$/);
const TEAM = (ctx: { tx: Parameters<Parameters<typeof withWorkspaceCtx>[2]>[0]["tx"] }) => ctx.tx`select id, name, key, created_at from teams`;
const getTeam = async (ctx: Parameters<typeof TEAM>[0], id: string) => {
  const r = await ctx.tx<Row[]>`${TEAM(ctx)} where id = ${id}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
export const listTeams = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const q = parseQuery(req, listQuery), c = afterId(ctx, "teams", q);
  const rows = await ctx.tx<Row[]>`${TEAM(ctx)} where ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "teams", q, rows);
});
export const createTeam = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const b = await parseJson(req, z.object({ name: nameS, key: keyS }).strict()), id = uuidv7();
  await ctx.tx`insert into teams (id, workspace_id, name, key) values (${id}, ${ctx.workspaceId}, ${b.name}, ${b.key})`;
  await audit(ctx, "team", id, "create", { name: { before: null, after: b.name }, key: { before: null, after: b.key } });
  return Response.json(await getTeam(ctx, id), { status: 201 });
});
export const patchTeam = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), b = await parseJson(req, z.object({ name: nameS }).strict()), before = await getTeam(ctx, id);
  await ctx.tx`update teams set name = ${b.name} where id = ${id}`; // key is immutable: it is baked into issue identifiers
  await audit(ctx, "team", id, "update", { name: { before: before.name, after: b.name } });
  return Response.json(await getTeam(ctx, id));
});
export const deleteTeam = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), before = await getTeam(ctx, id);
  await ctx.tx`delete from teams where id = ${id}`;
  await audit(ctx, "team", id, "delete", { name: { before: before.name, after: null } });
  return new Response(null, { status: 204 });
});
export const listTeamMembers = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId); await getTeam(ctx, id);
  const items = await ctx.tx<Row[]>`select t.user_id, u.email from team_memberships t join users u on u.id = t.user_id where t.team_id = ${id} order by t.user_id`;
  return Response.json({ items, next_cursor: null });
});
export const addTeamMember = (req: Request, slug: string, rawId: string, rawUid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), uid = parseId(rawUid); await getTeam(ctx, id); await roleOf(ctx.tx, uid); // target must be a workspace member
  const r = await ctx.tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ctx.workspaceId}, ${id}, ${uid}) on conflict do nothing returning user_id`;
  if (r.length) await audit(ctx, "team_member", id, "create", { user_id: { before: null, after: uid } });
  return Response.json({ team_id: id, user_id: uid }, { status: r.length ? 201 : 200 });
});
export const removeTeamMember = (req: Request, slug: string, rawId: string, rawUid: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), uid = parseId(rawUid); await getTeam(ctx, id);
  const r = await ctx.tx`delete from team_memberships where team_id = ${id} and user_id = ${uid} returning user_id`;
  if (r.length) await audit(ctx, "team_member", id, "delete", { user_id: { before: uid, after: null } });
  return new Response(null, { status: 204 });
});
