import { z } from "zod";
import { withWorkspaceCtx, requireRole } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId, parseQuery } from "../http/validate";
import { teamVisible, type Row } from "./common";
import { daysBetween } from "../cycles/plan";
import { computeBurndown, type BurnEvent, type BurnIssue } from "../cycles/burndown";

/**
 * Burndown: one point per day of the cycle {day, scope, done, remaining, ideal}, replayed from audit_events (status / cycle_id diffs).
 * Deleted issues drop out of the past scope (the replay only sees live issues). Cycles longer than MAX_DAYS days are refused (422): the replay is O(days x issues x events).
 * `?on=YYYY-MM-DD` is the chart's "today" (default: server date); days after it carry null scope/done/remaining. Empty history is fine.
 */
const MAX_DAYS = 120;
const isRealDate = (d: string) => { const t = new Date(`${d}T00:00:00.000Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };

export const cycleBurndown = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const q = parseQuery(req, z.object({ on: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).optional() }));
  if (q.on !== undefined && !isRealDate(q.on)) throw new ApiError("validation_failed", "on must be a real date (YYYY-MM-DD)");
  const id = parseId(rawId);
  const c = (await ctx.tx<Row[]>`select id, team_id, name, number, start_date::text as start_date, end_date::text as end_date, version from cycles where id = ${id} and ${teamVisible(ctx, "team_id")}`)[0];
  if (!c) throw new ApiError("not_found");
  if (daysBetween(c.start_date as string, c.end_date as string) + 1 > MAX_DAYS) throw new ApiError("validation_failed", `cycle spans more than ${MAX_DAYS} days`);
  const cid = c.id as string;
  const iss = await ctx.tx<{ id: string; created_at: Date; updated_at: Date; status: string; cycle_id: string | null }[]>`select id, created_at, updated_at, status::text as status, cycle_id from issues
    where deleted_at is null and (cycle_id = ${cid} or id in (select entity_id from audit_events where entity = 'issue' and entity_id is not null
      and diff ? 'cycle_id' and (diff->'cycle_id'->>'before' = ${cid} or diff->'cycle_id'->>'after' = ${cid})))`;
  const ids = iss.map((r) => r.id);
  const evs = ids.length ? await ctx.tx<{ issue_id: string; created_at: Date; diff: BurnEvent["diff"] }[]>`select entity_id as issue_id, created_at, diff from audit_events
    where entity = 'issue' and entity_id = any(${ids}::uuid[]) and (diff ? 'cycle_id' or diff ? 'status') order by created_at, id` : [];
  const issues: BurnIssue[] = iss.map((r) => ({ id: r.id, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(), status: r.status, cycle_id: r.cycle_id }));
  const events: BurnEvent[] = evs.map((e) => ({ issue_id: e.issue_id, at: e.created_at.toISOString(), diff: e.diff }));
  const points = computeBurndown({ id: cid, start_date: c.start_date as string, end_date: c.end_date as string }, issues, events, q.on ?? new Date().toISOString().slice(0, 10));
  return Response.json({ cycle: c, points });
});
