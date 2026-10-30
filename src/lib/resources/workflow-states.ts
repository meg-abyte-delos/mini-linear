import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, parseId, parseJson, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, assertTeamVisible } from "./common";

// ------------------------------------------------ workflow states (per team; Linear-style categories)
export const CATEGORIES = ["backlog", "unstarted", "started", "completed", "canceled"] as const;
const F = ["name", "color", "category", "position"];
const body = z.object({
  name: z.string().trim().min(1).max(64), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  category: z.enum(CATEGORIES), position: z.number().finite(),
}).strict();
const SEL = (ctx: Ctx) => ctx.tx`select id, team_id, name, color, category, position, version, created_at, updated_at from workflow_states`;

/** 404 for a team that does not exist or that the caller cannot see (no existence oracle). Guests have no team access. */
async function team(ctx: Ctx, rawId: string) {
  const id = parseId(rawId);
  if (ctx.role === "guest") throw new ApiError("not_found");
  const t = await ctx.tx`select 1 from teams where id = ${id}`;
  if (!t.length) throw new ApiError("not_found");
  await assertTeamVisible(ctx, id).catch(() => { throw new ApiError("not_found"); });
  return id;
}
async function getState(ctx: Ctx, teamId: string, id: string) {
  const r = await ctx.tx<Row[]>`${SEL(ctx)} where id = ${id} and team_id = ${teamId}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
}
/** Every category keeps at least one state, so a legacy `status` write can always be mapped to a state. */
async function assertNotLastOfCategory(ctx: Ctx, s: Row) {
  const r = await ctx.tx`select count(*)::int n from workflow_states where team_id = ${s.team_id as string} and category = ${s.category as string}`;
  if ((r[0]!.n as number) <= 1) throw new ApiError("validation_failed", `a team needs at least one ${s.category as string} state`);
}

export const listStates = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const teamId = await team(ctx, rawTeam);
  const rows = await ctx.tx<Row[]>`${SEL(ctx)} where team_id = ${teamId} order by position, id`;
  return Response.json({ items: rows, next_cursor: null }); // bounded per team: no pagination
});
export const getStateH = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) =>
  out(await getState(ctx, await team(ctx, rawTeam), parseId(rawId))));

export const createState = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam);
  const b = await parseJson(req, body.partial({ color: true, position: true }));
  const r = await ctx.tx`select coalesce(max(position), 0) + 1 p, count(*)::int n from workflow_states where team_id = ${teamId}`;
  if ((r[0]!.n as number) >= 50) throw new ApiError("validation_failed", "a team has at most 50 states");
  const id = uuidv7();
  await ctx.tx`insert into workflow_states (id, workspace_id, team_id, name, color, category, position)
    values (${id}, ${ctx.workspaceId}, ${teamId}, ${b.name}, ${b.color ?? "#888888"}, ${b.category}, ${b.position ?? (r[0]!.p as number)})`;
  const row = await getState(ctx, teamId, id);
  await audit(ctx, "workflow_state", id, "create", diffOf(null, row, F));
  return out(row, 201);
});

export const patchState = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam), id = parseId(rawId), want = ifMatchVersion(req);
  const b = await parseJson(req, body.partial());
  const before = await getState(ctx, teamId, id);
  if (Number(before.version) !== want) throw stale(before);
  const recat = b.category !== undefined && b.category !== before.category;
  if (recat) await assertNotLastOfCategory(ctx, before);
  const u = await ctx.tx`update workflow_states set name = ${b.name ?? (before.name as string)}, color = ${b.color ?? (before.color as string)},
    category = ${(b.category ?? before.category) as string}, position = ${b.position ?? (before.position as number)},
    legacy_status = ${recat ? null : ctx.tx`legacy_status`}, version = version + 1, updated_at = now()
    where id = ${id} and version = ${want} returning id`;
  if (!u.length) throw stale(before);
  if (recat) { // re-derive the legacy status of the issues in this state (state_id unchanged => trigger keeps it)
    const prev = await ctx.tx<Row[]>`select id, status from issues where state_id = ${id} and deleted_at is null`;
    const now = await ctx.tx<Row[]>`update issues set status = workflow_state_status(${b.category!}::workflow_state_category, null), version = version + 1, updated_at = now()
      where state_id = ${id} returning id, status`;
    const was = new Map(prev.map((r) => [r.id as string, r.status]));
    for (const r of now) if (was.has(r.id as string) && was.get(r.id as string) !== r.status)
      await audit(ctx, "issue", r.id as string, "update", { status: { before: was.get(r.id as string), after: r.status } });
  }
  const row = await getState(ctx, teamId, id);
  await audit(ctx, "workflow_state", id, "update", diffOf(before, row, F));
  return out(row);
});

/** DELETE ?replacement_id=<state of the same team>: required while issues (including soft-deleted ones) use the state. */
export const deleteState = (req: Request, slug: string, rawTeam: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const teamId = await team(ctx, rawTeam), id = parseId(rawId), want = ifMatchVersion(req);
  const before = await getState(ctx, teamId, id);
  if (Number(before.version) !== want) throw stale(before);
  await assertNotLastOfCategory(ctx, before);
  const rawRep = new URL(req.url).searchParams.get("replacement_id");
  const used = await ctx.tx`select count(*)::int n from issues where state_id = ${id}`;
  const n = used[0]!.n as number;
  if (n > 0) {
    if (!rawRep) throw new ApiError("conflict", "state is used by issues: pass replacement_id", { issue_count: n });
    const rep = uuidSchema.safeParse(rawRep);
    if (!rep.success || rep.data === id) throw new ApiError("validation_failed", "invalid replacement_id");
    await getState(ctx, teamId, rep.data).catch(() => { throw new ApiError("validation_failed", "invalid replacement_id"); });
    const moved = await ctx.tx<Row[]>`update issues set state_id = ${rep.data}, version = version + 1, updated_at = now() where state_id = ${id} returning id`;
    for (const m of moved) await audit(ctx, "issue", m.id as string, "update", { state_id: { before: id, after: rep.data } });
  }
  await ctx.tx`delete from workflow_states where id = ${id}`;
  await audit(ctx, "workflow_state", id, "delete", { ...diffOf(before, null, F), ...(n ? { replacement_id: { before: null, after: rawRep } } : {}) });
  return new Response(null, { status: 204 });
});
