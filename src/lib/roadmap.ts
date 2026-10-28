// Pure helpers for the projects list and the roadmap (timeline) view.
export const PROJECT_STATUS_LABEL: Record<string, string> = { backlog: 'Backlog', planned: 'Planned', in_progress: 'In progress', paused: 'Paused', completed: 'Completed', canceled: 'Canceled' };
export const statusLabel = (s?: string): string => (s ? (PROJECT_STATUS_LABEL[s] ?? s) : 'Backlog');

export interface Bar { leftPct: number; widthPct: number }
export interface Span { start: string | null | undefined; end: string | null | undefined }
const day = (iso: string): number => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

/** Timeline window covering every dated project, padded by a week each side. Null when no project has a date. */
export function roadmapRange(spans: Span[]): { from: string; to: string } | null {
  const ds = spans.flatMap((s) => [s.start, s.end]).filter((d): d is string => !!d).map(day);
  if (ds.length === 0) return null;
  const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
  return { from: iso(Math.min(...ds) - 7), to: iso(Math.max(...ds) + 7) };
}

/** Bar position inside the window. A project with only one date gets a 1-day marker; none gets null. */
export function barFor(span: Span, range: { from: string; to: string }): Bar | null {
  const a = span.start ?? span.end, b = span.end ?? span.start;
  if (!a || !b) return null;
  const total = Math.max(1, day(range.to) - day(range.from));
  const s = Math.max(day(range.from), Math.min(day(a), day(b))), e = Math.min(day(range.to), Math.max(day(a), day(b)) + 1);
  return { leftPct: ((s - day(range.from)) / total) * 100, widthPct: Math.max(1, ((e - s) / total) * 100) };
}

/** Where today falls in the window, as a percentage; null when outside. */
export function todayPct(today: string, range: { from: string; to: string }): number | null {
  const total = Math.max(1, day(range.to) - day(range.from)), p = ((day(today) - day(range.from)) / total) * 100;
  return p < 0 || p > 100 ? null : p;
}

export const isOverdue = (target: string | null | undefined, status: string | undefined, today: string): boolean =>
  !!target && status !== 'completed' && status !== 'canceled' && target < today;

export function progress(issues: { status: string }[]): { done: number; total: number; pct: number } {
  const live = issues.filter((i) => i.status !== 'canceled');
  const done = live.filter((i) => i.status === 'done').length;
  return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 };
}

export const sortProjects = <T extends { name: string; target_date?: string | null }>(p: readonly T[]): T[] =>
  [...p].sort((a, b) => (a.target_date ?? '9999') < (b.target_date ?? '9999') ? -1 : (a.target_date ?? '9999') > (b.target_date ?? '9999') ? 1 : a.name.localeCompare(b.name));
