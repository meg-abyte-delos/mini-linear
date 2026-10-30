// List view helpers (Linear parity): contextual dates, avatar hue/initials from an id, display options.

const HUES = ['h1', 'h2', 'h3', 'h4', 'h5'] as const;

/** Stable avatar hue from an id (FNV-1a), so API members get the same colour on every screen. */
export function hueOfId(id: string): string {
  let h = 0x811c9dc5;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; }
  return HUES[h % HUES.length]!;
}

/** "Ada Byte" -> "AB", "rex" -> "R". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/** Linear list date: one short format on every row ("Oct 29"; "Oct 29, 2025" for another year), so the column scans evenly. */
export function relDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export type Grouping = 'status' | 'none';
export type Ordering = 'manual' | 'priority' | 'created';
export const GROUPING_LABEL: Record<Grouping, string> = { status: 'Status', none: 'No grouping' };
export const ORDERING_LABEL: Record<Ordering, string> = { manual: 'Manual', priority: 'Priority', created: 'Created' };

export type DisplayProp = 'priority' | 'id' | 'status' | 'labels' | 'project' | 'created' | 'assignee';
export const DISPLAY_PROP_LABEL: Record<DisplayProp, string> = { priority: 'Priority', id: 'ID', status: 'Status', labels: 'Labels', project: 'Project', created: 'Created', assignee: 'Assignee' };

/** Priority 1 (urgent) first, 0 (none) last; created newest first; manual keeps the input order. Stable. */
export function orderIssues<T extends { priority: number; created_at: string }>(items: readonly T[], o: Ordering): T[] {
  if (o === 'manual') return [...items];
  const rank = (p: number) => (p === 0 ? 99 : p);
  return items.map((x, k) => ({ x, k })).sort((a, b) => {
    const c = o === 'priority' ? rank(a.x.priority) - rank(b.x.priority) : Date.parse(b.x.created_at) - Date.parse(a.x.created_at);
    return c || a.k - b.k;
  }).map((e) => e.x);
}

/** List groups exactly as rendered: one group per non-empty status (or a single 'all' group), each ordered. */
export function listGroups<T extends { status: string; priority: number; created_at: string }>(
  items: readonly T[], statuses: readonly string[], g: Grouping, o: Ordering, showEmpty = false,
): { key: string; status: string | null; items: T[] }[] {
  const groups = g === 'none'
    ? [{ key: 'all', status: null as string | null, items: orderIssues(statuses.flatMap((s) => items.filter((i) => i.status === s)), o) }]
    : statuses.map((s) => ({ key: s, status: s as string | null, items: orderIssues(items.filter((i) => i.status === s), o) }));
  return showEmpty && g !== 'none' ? groups : groups.filter((x) => x.items.length > 0);
}

/** Keyboard order (j/k): visible rows only, skipping collapsed groups. */
export function visibleOrder<T>(groups: readonly { key: string; items: T[] }[], collapsed: ReadonlySet<string>): T[] {
  return groups.flatMap((x) => (collapsed.has(x.key) ? [] : x.items));
}
