// Pure filter + cycle helpers. Filter state lives in the URL (?status=todo,done&assignee=u1&label=l1&project=p1&cycle=c2).
import { CYCLES, LABELS, PROJECTS, STATUSES, USERS, type Issue } from '@/lib/issues';

export const FILTER_KEYS = ['status', 'assignee', 'label', 'project', 'cycle'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Record<FilterKey, string[]>;
export const NONE = 'none'; // Unassigned / No project / No cycle

const KNOWN: Record<FilterKey, string[]> = {
  status: [...STATUSES],
  assignee: [NONE, ...USERS.map((u) => u.id)],
  label: LABELS.map((l) => l.id),
  project: [NONE, ...PROJECTS.map((p) => p.id)],
  cycle: [NONE, ...CYCLES.map((c) => c.id)],
};

export const emptyFilters = (): Filters => ({ status: [], assignee: [], label: [], project: [], cycle: [] });

/** Unknown values are dropped, duplicates removed; order follows the known lists. */
export function parseFilters(sp: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const get = (k: string): string => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? '';
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const f = emptyFilters();
  for (const k of FILTER_KEYS) {
    const want = new Set(get(k).split(',').filter(Boolean));
    f[k] = KNOWN[k].filter((v) => want.has(v));
  }
  return f;
}

/** New query string (no leading ?), keeping unrelated params such as seed/state. */
export function writeFilters(search: string, f: Filters): string {
  const sp = new URLSearchParams(search);
  for (const k of FILTER_KEYS) { if (f[k].length) sp.set(k, f[k].join(',')); else sp.delete(k); }
  return sp.toString().replace(/%2C/gi, ',');
}

export const activeCount = (f: Filters) => FILTER_KEYS.reduce((n, k) => n + f[k].length, 0);

/** AND across dimensions, OR within one (labels: any of). */
export function applyFilters(issues: Issue[], f: Filters): Issue[] {
  const has = (k: FilterKey) => f[k].length > 0;
  return issues.filter((i) =>
    (!has('status') || f.status.includes(i.status)) &&
    (!has('assignee') || f.assignee.includes(i.assignee_id ?? NONE)) &&
    (!has('project') || f.project.includes(i.project_id ?? NONE)) &&
    (!has('cycle') || f.cycle.includes(i.cycle_id ?? NONE)) &&
    (!has('label') || i.label_ids.some((l) => f.label.includes(l))));
}

export type CycleBucket = 'active' | 'upcoming' | 'past';
/** Dates are YYYY-MM-DD (UTC, inclusive bounds), compared as strings. */
export function cycleBucket(c: { start_date: string; end_date: string }, today: string): CycleBucket {
  if (today < c.start_date) return 'upcoming';
  if (today > c.end_date) return 'past';
  return 'active';
}
export const TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;
