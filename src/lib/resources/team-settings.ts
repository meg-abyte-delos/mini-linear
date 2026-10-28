import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, listQuery, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { ESTIMATE_SCALES, HEX } from "../team-config";
import { type Row, stale, out, audit, listPage, afterId, assertTeamVisible, assertTeamAdmin } from "./common";

// Permissions: reading a team's configuration needs team visibility (admins: all teams; members: their teams; guests:
// none, same 404 as an unknown team). Editing needs a team admin (assertTeamAdmin: workspace owner/admin or admin of that
// team). Workflow states (0101) and cycle config (0301) are not handled here.
async function teamFor(ctx: Ctx, rawTeam: string, edit: boolean) {
  const id = parseId(rawTeam);
  if (ctx.role === "guest") throw new ApiError("not_found");
  const r = await ctx.tx`select 1 from teams where id = ${id}`;
  if (!r.length) throw new ApiError("not_found");
  try { await assertTeamVisible(ctx, id); } catch { throw new ApiError("not_found"); }
  if (edit) await assertTeamAdmin(ctx, id);
  return id;
}

// ------------------------------------------------ team settings (estimates)
const SET_F = ["estimate_scale", "estimate_allow_zero"];
const settingsBody = z.object({ estimate_scale: z.enum(ESTIMATE_SCALES), estimate_allow_zero: z.boolean() }).strict().partial();
const getSettingsRow = async (ctx: Ctx, team: string) => {
  let r = await ctx.tx<Row[]>`select team_id, ${ctx.tx(SET_F)}, version, updated_at from team_settings where team_id = ${team}`;
  if (!r[0]) { // team created before the defaults trigger existed and missed the backfill: heal lazily
    await ctx.tx`insert into team_settings (team_id, workspace_id) values (${team}, ${ctx.workspaceId}) on conflict do nothing`;
    r = await ctx.tx<Row[]>`select team_id, ${ctx.tx(SET_F)}, version, updated_at from team_settings where team_id = ${team}`;
  }
  return r[0]!;
};
export const getSettings = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) =>
  out(await getSettingsRow(ctx, await teamFor(ctx, rawTeam, false))));
export const patchSettings = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const team = await teamFor(ctx, rawTeam, true);
  const want = ifMatchVersion(req), b = await parseJson(req, settingsBody), before = await getSettingsRow(ctx, team);
  if (Number(before.version) !== want) throw stale(before);
  const v = { ...before, ...b } as Record<string, unknown>;
  const u = await ctx.tx`update team_settings set estimate_scale = ${v.estimate_scale as string}, estimate_allow_zero = ${v.estimate_allow_zero as boolean}, version = version + 1, updated_at = now() where team_id = ${team} and version = ${want} returning team_id`;
  if (!u.length) throw stale(before);
  const row = await getSettingsRow(ctx, team);
  await audit(ctx, "team_settings", team, "update", diffOf(before, row, SET_F));
  return out(row);
});

// ------------------------------------------------ label groups (workspace-level when team_id is null)
const GROUP_F = ["team_id", "name", "color"];
const groupBody = z.object({ name: z.string().trim().min(1).max(64), color: z.string().regex(HEX), team_id: uuidSchema.nullable() }).strict();
const GSEL = (ctx: Ctx) => ctx.tx`select id, team_id, name, color, version, created_at, updated_at from label_groups`;
/** Members see workspace-level rows plus rows of the teams they belong to. */
export const scopeVisible = (ctx: Ctx, table: "labels" | "label_groups") => ctx.role === "owner" || ctx.role === "admin" ? ctx.tx`true`
  : ctx.tx`(${ctx.tx(table)}.team_id is null or exists (select 1 from team_memberships tm where tm.team_id = ${ctx.tx(table)}.team_id and tm.user_id = ${ctx.userId}))`;
const getGroup = async (ctx: Ctx, id: string) => {
  const r = await ctx.tx<Row[]>`${GSEL(ctx)} where id = ${id} and ${scopeVisible(ctx, "label_groups")}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
};
export const listGroups = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const q = parseQuery(req, listQuery.extend({ team_id: uuidSchema.optional() })), c = afterId(ctx, "label_groups", q);
  const rows = await ctx.tx<Row[]>`${GSEL(ctx)} where ${scopeVisible(ctx, "label_groups")} and ${c ? ctx.tx`id > ${c}::uuid` : ctx.tx`true`}
    ${q.team_id ? ctx.tx`and (team_id is null or team_id = ${q.team_id})` : ctx.tx``} order by id limit ${q.limit + 1}`;
  return listPage(ctx, "label_groups", q, rows);
});
export const createGroup = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const b = await parseJson(req, groupBody.partial({ color: true, team_id: true })), id = uuidv7();
  if (b.team_id) await assertTeamVisible(ctx, b.team_id);
  await assertScopeAdmin(ctx, b.team_id ?? null);
  await ctx.tx`insert into label_groups (id, workspace_id, team_id, name, color) values (${id}, ${ctx.workspaceId}, ${b.team_id ?? null}, ${b.name}, ${b.color ?? "#888888"})`;
  const row = await getGroup(ctx, id);
  await audit(ctx, "label_group", id, "create", diffOf(null, row, GROUP_F));
  return out(row, 201);
});
export const getGroupH = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => { requireRole(ctx, "member"); return out(await getGroup(ctx, parseId(rawId))); });
export const patchGroup = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId), want = ifMatchVersion(req), b = await parseJson(req, groupBody.omit({ team_id: true }).partial()), before = await getGroup(ctx, id);
  await assertScopeAdmin(ctx, before.team_id as string | null);
  if (Number(before.version) !== want) throw stale(before);
  const u = await ctx.tx`update label_groups set name = ${b.name ?? (before.name as string)}, color = ${b.color ?? (before.color as string)}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  const row = await getGroup(ctx, id);
  await audit(ctx, "label_group", id, "update", diffOf(before, row, GROUP_F));
  return out(row);
});
export const deleteGroup = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const id = parseId(rawId), want = ifMatchVersion(req), before = await getGroup(ctx, id);
  await assertScopeAdmin(ctx, before.team_id as string | null);
  if (Number(before.version) !== want) throw stale(before);
  await ctx.tx`delete from label_groups where id = ${id}`; // member labels survive, ungrouped (FK SET NULL)
  await audit(ctx, "label_group", id, "delete", diffOf(before, null, GROUP_F));
  return new Response(null, { status: 204 });
});

/** Scope write guard for labels and groups: workspace-level (team null) needs a workspace admin, team-level a team admin. */
export async function assertScopeAdmin(ctx: Ctx, teamId: string | null) {
  if (teamId) await assertTeamAdmin(ctx, teamId); else requireRole(ctx, "admin");
}
