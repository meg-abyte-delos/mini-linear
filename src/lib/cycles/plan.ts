/** Pure cycle planning (no I/O). Dates are 'YYYY-MM-DD' strings; weekday 0 = Sunday. */
export type CycleSettings = { duration_days: number; cooldown_days: number; start_weekday: number; upcoming_count: number };
export type Span = { start_date: string; end_date: string };

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const weekday = (d: string) => new Date(ms(d)).getUTCDay();
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY);

/**
 * Cycles to create so that the current cycle (if the schedule has one) plus `upcoming_count` future cycles exist.
 * First cycle of a team starts on the latest start_weekday on or before `today`; later ones follow the previous end + cooldown.
 */
export function planCycles(existing: Span[], s: CycleSettings, today: string): Span[] {
  const sorted = [...existing].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const out: Span[] = [];
  let next: string;
  const last = sorted[sorted.length - 1];
  if (last) next = addDays(last.end_date, 1 + s.cooldown_days);
  else next = addDays(today, -((weekday(today) - s.start_weekday + 7) % 7));
  const future = () => [...sorted, ...out].filter((c) => c.start_date > today).length;
  const hasCurrent = () => [...sorted, ...out].some((c) => c.start_date <= today && c.end_date >= today);
  for (let guard = 0; guard < 200; guard++) {
    // stop once there is a current-or-past-covering state and enough future cycles
    if (future() >= s.upcoming_count && (hasCurrent() || next > today)) break;
    const span = { start_date: next, end_date: addDays(next, s.duration_days - 1) };
    if (span.end_date < today && !last && out.length === 0) { next = addDays(span.end_date, 1 + s.cooldown_days); continue; }
    out.push(span);
    next = addDays(span.end_date, 1 + s.cooldown_days);
  }
  return out;
}

export type Burn = { day: string; scope: number; started: number; completed: number };
/** Fill gaps between snapshots (carry forward) up to min(today, end) so charts have one point per day. */
export function fillBurn(snaps: Burn[], start: string, end: string, today: string): Burn[] {
  const by = new Map(snaps.map((x) => [x.day, x]));
  const stop = end < today ? end : today, res: Burn[] = [];
  let prev: Burn | undefined;
  for (let d = start; d <= stop; d = addDays(d, 1)) {
    const cur = by.get(d) ?? (prev ? { ...prev, day: d } : undefined);
    if (cur) { res.push(cur); prev = cur; }
  }
  return res;
}
