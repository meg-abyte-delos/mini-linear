// Pure keyboard-navigation helpers shared by Menu and Combobox (no DOM, unit-tested).
export interface NavItem { disabled?: boolean; label?: string }

export function firstEnabled(items: NavItem[]): number {
  return items.findIndex((i) => !i.disabled);
}
export function lastEnabled(items: NavItem[]): number {
  for (let k = items.length - 1; k >= 0; k--) if (!items[k]?.disabled) return k;
  return -1;
}
// Next enabled index in direction dir (1 | -1), wrapping. -1 when nothing is enabled.
export function moveIndex(items: NavItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  if (!items.some((i) => !i.disabled)) return -1;
  let k = from;
  for (let step = 0; step < n; step++) {
    k = (k + dir + n) % n;
    if (!items[k]?.disabled) return k;
  }
  return -1;
}
// Typeahead: first enabled item whose label starts with the typed prefix, searching from the item after `from` (wraps).
// Typing one letter repeatedly cycles through the items starting with that letter.
export function typeahead(items: NavItem[], from: number, typed: string): number {
  const q = typed.toLowerCase();
  const first = q[0];
  if (!first) return -1;
  const prefix = [...q].every((c) => c === first) ? first : q;
  const start = prefix.length === 1 ? from + 1 : from;
  const n = items.length;
  for (let step = 0; step < n; step++) {
    const k = (start + step + n) % n;
    const it = items[k];
    if (it && !it.disabled && (it.label ?? '').toLowerCase().startsWith(prefix)) return k;
  }
  return -1;
}
