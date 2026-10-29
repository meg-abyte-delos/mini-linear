/** Pure cycle burndown (no I/O). Replays audit events (status / cycle_id diffs) to know, for each day, which issues were in the cycle and which were done. */
import { addDays, daysBetween } from "./plan";

export type Diff = Record<string, { before: unknown; after: unknown }>;
export type BurnIssue = { id: string; created_at: string; updated_at: string; status: string; cycle_id: string | null };
export type BurnEvent = { issue_id: string; at: string; diff: Diff };
export type BurnPoint = { day: string; scope: number | null; done: number | null; remaining: number | null; ideal: number };

const endOf = (d: string) => `${d}T23:59:59.999Z`;

type State = { cycle: string | null; status: string };

/** State of one issue at instant `t` (ISO string). Fields never touched by an event keep their current value. */
function stateAt(i: BurnIssue, evs: BurnEvent[], t: string, closedBy: string): State {
  const firstOf = (k: string) => evs.find((e) => k in e.diff);
  const c0 = firstOf("cycle_id"), s0 = firstOf("status");
  const st: State = {
    cycle: c0 ? ((c0.diff.cycle_id!.before as string | null) ?? null) : i.cycle_id,
    status: s0 ? String(s0.diff.status!.before ?? "backlog") : i.status,
  };
  // Closed with no recorded status event (history missing): treat it as closed from its last update, open before.
  if (!s0 && (i.status === "done" || i.status === "canceled")) st.status = (i.updated_at < closedBy ? i.updated_at : closedBy) <= t ? i.status : "backlog";
  for (const e of evs) {
    if (e.at > t) break;
    if (e.diff.cycle_id) st.cycle = (e.diff.cycle_id.after as string | null) ?? null;
    if (e.diff.status) st.status = String(e.diff.status.after ?? st.status);
  }
  return st;
}

/**
 * One point per day from start to end. scope = issues in the cycle that are not canceled, done = those done, at the end of that day (UTC).
 * Days after `on` have null scope/done/remaining (the ideal line still spans the whole cycle). Tolerant of missing history:
 * an issue with no cycle event is taken as in the cycle since its start (or its creation if earlier), and one closed with no status event as
 * closed at its last update, at the latest on the cycle's last day.
 */
export function computeBurndown(cycle: { id: string; start_date: string; end_date: string }, issues: BurnIssue[], events: BurnEvent[], on: string): BurnPoint[] {
  const by = new Map<string, BurnEvent[]>();
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const l = by.get(e.issue_id) ?? []; l.push(e); by.set(e.issue_id, l);
  }
  const at = (t: string) => {
    let scope = 0, done = 0;
    for (const i of issues) {
      const evs = by.get(i.id) ?? [];
      // No recorded cycle assignment (e.g. rows loaded without history): in the cycle from its start at the latest.
      const born = evs.some((e) => "cycle_id" in e.diff) || i.created_at < `${cycle.start_date}T00:00:00.000Z` ? i.created_at : `${cycle.start_date}T00:00:00.000Z`;
      if (born > t) continue;
      const s = stateAt(i, evs, t, endOf(cycle.end_date));
      if (s.cycle !== cycle.id || s.status === "canceled") continue;
      scope++;
      if (s.status === "done") done++;
    }
    return { scope, done };
  };
  const n = daysBetween(cycle.start_date, cycle.end_date) + 1;
  if (n < 1) return [];
  const scope0 = at(endOf(cycle.start_date)).scope;
  const out: BurnPoint[] = [];
  for (let k = 0; k < n; k++) {
    const day = addDays(cycle.start_date, k);
    const ideal = n === 1 ? 0 : Math.round(scope0 * (1 - k / (n - 1)) * 100) / 100;
    if (day > on) { out.push({ day, scope: null, done: null, remaining: null, ideal }); continue; }
    const { scope, done } = at(endOf(day));
    out.push({ day, scope, done, remaining: scope - done, ideal });
  }
  return out;
}
