import { z } from "zod";
import { withWorkspaceCtx, requireRole } from "../http/ctx";
import { ApiError } from "../http/errors";
import { parseId, parseQuery } from "../http/validate";
import { teamVisible, type Row } from "./common";
import { computeBurndown, type BurnEvent, type BurnIssue } from "../cycles/burndown";

/**
 * Burndown: one point per day of the cycle {day, scope, done, remaining, ideal}, replayed from audit_events (status / cycle_id diffs).
 * `?on=YYYY-MM-DD` is the chart's "today" (default: server date); days after it carry null scope/done/remaining. Empty history is fine.
 */
export const cycleBurndown = (req: Request, slug: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const q = parseQuery(req, z.object({ on: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).optional() }));
  const id = parseId(rawId);
  const c = (await ctx.tx<Row[]>`select id, team_id, name, number, start_date::text as start_date, end_date::text as end_date, version from cycles where id = ${id} and ${teamVisible(ctx, "team_id")}`)[0];
  if (!c) throw new ApiError("not_found");
  const cid = c.id as string;
  const iss = await ctx.tx<{ id: string; created_at: Date; updated_at: Date; status: string; cycle_id: string | null }[]>`select id, created_at, updated_at, status::text as status, cycle_id from issues
    where deleted_at is null and (cycle_id = ${cid} or id in (select entity_id from audit_events where entity = 'issue' and entity_id is not null
      and (diff->'cycle_id'->>'before' = ${cid} or diff->'cycle_id'->>'after' = ${cid})))`;
  const ids = iss.map((r) => r.id);
  const evs = ids.length ? await ctx.tx<{ issue_id: string; created_at: Date; diff: BurnEvent["diff"] }[]>`select entity_id as issue_id, created_at, diff from audit_events
    where entity = 'issue' and entity_id = any(${ids}::uuid[]) and (diff ? 'cycle_id' or diff ? 'status') order by created_at, id` : [];
  const issues: BurnIssue[] = iss.map((r) => ({ id: r.id, created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(), status: r.status, cycle_id: r.cycle_id }));
  const events: BurnEvent[] = evs.map((e) => ({ issue_id: e.issue_id, at: e.created_at.toISOString(), diff: e.diff }));
  const points = computeBurndown({ id: cid, start_date: c.start_date as string, end_date: c.end_date as string }, issues, events, q.on ?? new Date().toISOString().slice(0, 10));
  return Response.json({ cycle: c, points });
});
