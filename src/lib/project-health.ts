// Derived project health (A1). Pure, so the rule is unit-tested and documented in docs/API.md.
// health_computed is null when the project is planned or finished (completed/canceled), has no target_date, or has no countable issue.
// Otherwise: expected% = share of the [start, target] window elapsed today (start = start_date, else created day);
//   progress 100% => on_track; past target and not 100% => off_track;
//   gap = expected% - progress_pct; gap <= 10 on_track, <= 25 at_risk, else off_track.
export type ComputedHealth = 'on_track' | 'at_risk' | 'off_track';
export interface HealthInput { status: string; start_date: string | null; target_date: string | null; created_at: Date | string; issue_count: number; progress_pct: number }
const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export function computeHealth(p: HealthInput, today: string): ComputedHealth | null {
  if (p.status === 'planned' || p.status === 'completed' || p.status === 'canceled' || !p.target_date || p.issue_count === 0) return null;
  const target = day(p.target_date), now = day(today);
  if (p.progress_pct >= 100) return 'on_track';
  if (now > target) return 'off_track';
  const created = p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at);
  const start = Math.min(day(p.start_date ?? created), target);
  const span = target - start;
  const expected = span <= 0 ? 100 : Math.max(0, Math.min(100, ((now - start) / span) * 100));
  const gap = expected - p.progress_pct;
  return gap <= 10 ? 'on_track' : gap <= 25 ? 'at_risk' : 'off_track';
}
