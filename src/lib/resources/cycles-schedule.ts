import { z } from "zod";
import { withWorkspaceCtx, requireRole, type Ctx } from "../http/ctx";
import { ApiError } from "../http/errors";
import { ifMatchVersion, parseId, parseJson, parseQuery, uuidSchema } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { type Row, stale, out, audit, assertTeamVisible, teamVisible } from "./common";
import { planCycles, fillBurn, type CycleSettings } from "../cycles/plan";

const SET_F = ["enabled", "duration_days", "cooldown_days", "start_weekday", "upcoming_count", "auto_rollover"];
const today = () => new Date().toISOString().slice(0, 10);
const settingsBody = z.object({
  enabled: z.boolean(), duration_days: z.number().int().min(1).max(90), cooldown_days: z.number().int().min(0).max(30),
  start_weekday: z.number().int().min(0).max(6), upcoming_count: z.number().int().min(1).max(6), auto_rollover: z.boolean(),
}).strict().partial();
const DEFAULTS = { enabled: false, duration_days: 14, cooldown_days: 0, start_weekday: 1, upcoming_count: 2, auto_rollover: true };

async function loadSettings(ctx: Ctx, teamId: string): Promise<Row> {
  await assertTeamVisible(ctx, teamId);
  const t = await ctx.tx`select 1 from teams where id = ${teamId}`;
  if (!t.length) throw new ApiError("not_found");
  const r = await ctx.tx<Row[]>`select team_id, enabled, duration_days, cooldown_days, start_weekday, upcoming_count, auto_rollover, version from team_cycle_settings where team_id = ${teamId}`;
  return r[0] ?? { team_id: teamId, ...DEFAULTS, version: 0 };
}

export const getCycleSettings = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  return out(await loadSettings(ctx, parseId(rawTeam)));
});

/** Upsert. version 0 (no row yet) is created without If-Match semantics beyond "0". */
export const putCycleSettings = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const team = parseId(rawTeam), want = ifMatchVersion(req), b = await parseJson(req, settingsBody);
  const before = await loadSettings(ctx, team);
  if (Number(before.version) !== want) throw stale(before);
  const m = { ...before, ...b } as Row & typeof DEFAULTS;
  if (want === 0) {
    await ctx.tx`insert into team_cycle_settings (team_id, workspace_id, enabled, duration_days, cooldown_days, start_weekday, upcoming_count, auto_rollover)
      values (${team}, ${ctx.workspaceId}, ${m.enabled}, ${m.duration_days}, ${m.cooldown_days}, ${m.start_weekday}, ${m.upcoming_count}, ${m.auto_rollover})`;
  } else {
    const u = await ctx.tx`update team_cycle_settings set enabled = ${m.enabled}, duration_days = ${m.duration_days}, cooldown_days = ${m.cooldown_days},
      start_weekday = ${m.start_weekday}, upcoming_count = ${m.upcoming_count}, auto_rollover = ${m.auto_rollover}, version = version + 1, updated_at = now()
      where team_id = ${team} and version = ${want} returning team_id`;
    if (!u.length) throw stale(before);
  }
  const row = await loadSettings(ctx, team);
  await audit(ctx, "cycle_settings", team, "update", diffOf(before, row, SET_F));
  return out(row);
});

/** Create missing upcoming cycles for one team. Idempotent. Returns the created cycles. */
export async function ensureUpcoming(ctx: Ctx, teamId: string, on = today()): Promise<Row[]> {
  const s = await loadSettings(ctx, teamId);
  if (!s.enabled) return [];
  const have = await ctx.tx<Row[]>`select start_date::text as start_date, end_date::text as end_date from cycles where team_id = ${teamId} order by start_date`;
  const plan = planCycles(have as never, s as unknown as CycleSettings, on);
  const created: Row[] = [];
  let n = Number((await ctx.tx`select coalesce(max(number), 0) as m from cycles where team_id = ${teamId}`)[0]!.m);
  for (const p of plan) {
    const id = uuidv7(); n += 1;
    await ctx.tx`insert into cycles (id, workspace_id, team_id, name, number, start_date, end_date) values (${id}, ${ctx.workspaceId}, ${teamId}, ${"Cycle " + n}, ${n}, ${p.start_date}, ${p.end_date})`;
    created.push({ id, team_id: teamId, name: `Cycle ${n}`, number: n, ...p });
    await audit(ctx, "cycle", id, "create", diffOf(null, created[created.length - 1]!, ["team_id", "name", "start_date", "end_date"]));
  }
  return created;
}
export const ensureCycles = (req: Request, slug: string, rawTeam: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  return Response.json({ created: await ensureUpcoming(ctx, parseId(rawTeam)) }, { status: 200 });
});

const CY = (ctx: Ctx) => ctx.tx`select id, team_id, name, number, start_date::text as start_date, end_date::text as end_date, version from cycles`;
/** current / next / previous relative to today for a team. */
export const cycleWindow = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const q = parseQuery(req, z.object({ team_id: uuidSchema, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }));
  await assertTeamVisible(ctx, q.team_id);
  const d = q.on ?? today();
  const one = async (where: ReturnType<Ctx["tx"]>, order: "asc" | "desc") =>
    (await ctx.tx<Row[]>`${CY(ctx)} where team_id = ${q.team_id} and ${where} order by start_date ${ctx.tx.unsafe(order)} limit 1`)[0] ?? null;
  return Response.json({
    current: await one(ctx.tx`start_date <= ${d} and end_date >= ${d}`, "asc"),
    next: await one(ctx.tx`start_date > ${d}`, "asc"),
    previous: await one(ctx.tx`end_date < ${d}`, "desc"),
  });
});

const SCOPE = (ctx: Ctx, cycleId: string) => ctx.tx<Row[]>`select
  count(*)::int as scope,
  count(*) filter (where status in ('in_progress','in_review'))::int as started,
  count(*) filter (where status = 'done')::int as completed,
  count(*) filter (where status = 'canceled')::int as canceled
  from issues where cycle_id = ${cycleId} and deleted_at is null`;

async function cycleOf(ctx: Ctx, id: string): Promise<Row> {
  const r = await ctx.tx<Row[]>`${CY(ctx)} where id = ${id} and ${teamVisible(ctx, "team_id")}`;
  if (!r[0]) throw new ApiError("not_found");
  return r[0];
}
/** Live totals + daily snapshots for the burn-up chart. Canceled issues are excluded from scope. */
export const cycleStats = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const c = await cycleOf(ctx, parseId(rawId));
  const live = (await SCOPE(ctx, c.id as string))[0]!;
  const snaps = await ctx.tx<{ day: string; scope: number; started: number; completed: number }[]>`select day::text as day, scope, started, completed from cycle_snapshots where cycle_id = ${c.id as string} order by day`;
  const t = today();
  const series = fillBurn(snaps, c.start_date as string, c.end_date as string, t);
  const scope = Number(live.scope) - Number(live.canceled);
  return Response.json({ cycle: c, scope, started: live.started, completed: live.completed, canceled: live.canceled,
    percent_complete: scope === 0 ? 0 : Math.round((Number(live.completed) / scope) * 100), series });
});

/** Record today's snapshot for every cycle running today (called by the scheduler; idempotent per day). */
export async function snapshotRunning(ctx: Ctx, on = today()): Promise<number> {
  const r = await ctx.tx`insert into cycle_snapshots (cycle_id, workspace_id, day, scope, started, completed)
    select c.id, c.workspace_id, ${on}::date,
      count(i.id) filter (where i.status <> 'canceled'), count(i.id) filter (where i.status in ('in_progress','in_review')), count(i.id) filter (where i.status = 'done')
    from cycles c left join issues i on i.cycle_id = c.id and i.deleted_at is null
    where c.start_date <= ${on}::date and c.end_date >= ${on}::date and ${teamVisible(ctx, "team_id")}
    group by c.id, c.workspace_id
    on conflict (cycle_id, day) do update set scope = excluded.scope, started = excluded.started, completed = excluded.completed returning cycle_id`;
  return r.length;
}
/** Record `on`'s snapshot for ONE cycle the caller has already been authorized to see (no team filter here). Only when `on` lies inside the cycle; idempotent per day. */
export async function snapshotCycle(ctx: Ctx, cycleId: string, on = today()): Promise<boolean> {
  const r = await ctx.tx`insert into cycle_snapshots (cycle_id, workspace_id, day, scope, started, completed)
    select c.id, c.workspace_id, ${on}::date,
      count(i.id) filter (where i.status <> 'canceled'), count(i.id) filter (where i.status in ('in_progress','in_review')), count(i.id) filter (where i.status = 'done')
    from cycles c left join issues i on i.cycle_id = c.id and i.deleted_at is null
    where c.id = ${cycleId} and c.start_date <= ${on}::date and c.end_date >= ${on}::date
    group by c.id, c.workspace_id
    on conflict (cycle_id, day) do update set scope = excluded.scope, started = excluded.started, completed = excluded.completed returning cycle_id`;
  return r.length > 0;
}
export const snapshotCycles = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  return Response.json({ snapshotted: await snapshotRunning(ctx) });
});

/**
 * Close a cycle: unfinished issues (not done/canceled) move to the team's next cycle, or back to no cycle when none exists;
 * the cycle gets completed_at. One transaction (all or nothing). Idempotent guard: a second call is 409, nothing moves.
 */
export const completeCycle = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const id = parseId(rawId), c = await cycleOf(ctx, id);
  const lock = await ctx.tx`update cycles set completed_at = now(), version = version + 1, updated_at = now() where id = ${id} and completed_at is null returning id`;
  if (!lock.length) throw new ApiError("conflict", "cycle already completed");
  const nx = (await ctx.tx<Row[]>`${CY(ctx)} where team_id = ${c.team_id as string} and start_date > ${c.end_date as string} order by start_date limit 1`)[0];
  const moved = await ctx.tx<Row[]>`update issues set cycle_id = ${nx ? (nx.id as string) : null}, version = version + 1, updated_at = now()
    where cycle_id = ${id} and deleted_at is null and status not in ('done','canceled') returning id`;
  for (const m of moved) await audit(ctx, "issue", m.id as string, "cycle_rollover", { cycle_id: { before: id, after: nx ? nx.id : null } });
  await audit(ctx, "cycle", id, "complete", { moved: { before: null, after: moved.length } });
  return Response.json({ moved: moved.length, next_cycle_id: nx ? nx.id : null });
});
