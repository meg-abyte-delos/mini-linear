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

/** Linear-style contextual date: "Today", "Yesterday", "3d ago" within a week, "Oct 29" this year, "Oct 29, 2025" otherwise. */
export function relDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff}d ago`;
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
}

export type Grouping = 'status' | 'none';
export type Ordering = 'manual' | 'priority' | 'created';
export const GROUPING_LABEL: Record<Grouping, string> = { status: 'Status', none: 'No grouping' };
export const ORDERING_LABEL: Record<Ordering, string> = { manual: 'Manual', priority: 'Priority', created: 'Created' };

/** Priority 1 (urgent) first, 0 (none) last; created newest first; manual keeps the input order. Stable. */
export function orderIssues<T extends { priority: number; created_at: string }>(items: readonly T[], o: Ordering): T[] {
  if (o === 'manual') return [...items];
  const rank = (p: number) => (p === 0 ? 99 : p);
  return items.map((x, k) => ({ x, k })).sort((a, b) => {
    const c = o === 'priority' ? rank(a.x.priority) - rank(b.x.priority) : Date.parse(b.x.created_at) - Date.parse(a.x.created_at);
    return c || a.k - b.k;
  }).map((e) => e.x);
}
