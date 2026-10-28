// Shared shortcut registry: single source of truth for keyboard shortcuts, the ? overlay and palette hints.
export interface Shortcut { id: string; keys: string[]; label: string; group: 'Issues' | 'Navigation' | 'Selection' | 'General' }
export const SHORTCUTS: Shortcut[] = [
  { id: 'create', keys: ['c'], label: 'Create issue', group: 'Issues' },
  { id: 'status', keys: ['s'], label: 'Change status', group: 'Issues' },
  { id: 'priority', keys: ['p'], label: 'Set priority', group: 'Issues' },
  { id: 'assignee', keys: ['a'], label: 'Set assignee', group: 'Issues' },
  { id: 'label', keys: ['l'], label: 'Set label', group: 'Issues' },
  { id: 'open', keys: ['Enter'], label: 'Open issue', group: 'Issues' },
  { id: 'next', keys: ['j'], label: 'Next issue', group: 'Navigation' },
  { id: 'prev', keys: ['k'], label: 'Previous issue', group: 'Navigation' },
  { id: 'go-issues', keys: ['g', 'i'], label: 'Go to issues', group: 'Navigation' },
  { id: 'go-views', keys: ['g', 'v'], label: 'Go to board view', group: 'Navigation' },
  { id: 'go-projects', keys: ['g', 'p'], label: 'Go to projects', group: 'Navigation' },
  { id: 'toggle-select', keys: ['x'], label: 'Select / unselect issue', group: 'Selection' },
  { id: 'extend-next', keys: ['Shift+J'], label: 'Extend selection down', group: 'Selection' },
  { id: 'extend-prev', keys: ['Shift+K'], label: 'Extend selection up', group: 'Selection' },
  { id: 'palette', keys: ['Mod+K'], label: 'Command palette', group: 'General' },
  { id: 'help', keys: ['?'], label: 'Keyboard shortcuts', group: 'General' },
  { id: 'escape', keys: ['Escape'], label: 'Close / clear selection', group: 'General' },
];
export const SEQUENCE_TIMEOUT_MS = 1500;
export const formatKeys = (keys: string[]) => keys.map((k) => (k.length === 1 ? k.toUpperCase() : k.replace('Mod', '⌘').replace('Escape', 'Esc'))).join(' then ');

export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true);
}
// Normalise a key event into a registry key ('j', 'Shift+J', 'Mod+K', '?', 'Enter').
export function keyOf(e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): string | null {
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) return `Mod+${e.key.toUpperCase()}`;
  if (e.key.length !== 1) return e.key;
  if (!/[a-z]/i.test(e.key)) return e.key;
  return e.shiftKey ? `Shift+${e.key.toUpperCase()}` : e.key.toLowerCase();
}
// Stateful matcher supporting two-key sequences ("g" then "i"). feed() returns the matched id, 'pending' or null.
export function createMatcher(defs: Shortcut[] = SHORTCUTS, now: () => number = Date.now) {
  let prefix: string | null = null, at = 0;
  return {
    feed(key: string): string | null {
      if (prefix && now() - at <= SEQUENCE_TIMEOUT_MS) {
        const hit = defs.find((d) => d.keys.length === 2 && d.keys[0] === prefix && d.keys[1] === key);
        prefix = null; if (hit) return hit.id;
      }
      prefix = null;
      if (defs.some((d) => d.keys.length === 2 && d.keys[0] === key)) { prefix = key; at = now(); return 'pending'; }
      return defs.find((d) => d.keys.length === 1 && d.keys[0] === key)?.id ?? null;
    },
    reset() { prefix = null; },
  };
}
