// Inbox data access behind one interface: HTTP (API mode) or in-memory (mock mode, used by the e2e suite).
export type NotifType = 'assigned' | 'mention' | 'comment' | 'status_change' | 'due_soon';
export type Notif = {
  id: string; type: NotifType; issue_id: string; comment_id: string | null; actor_id: string | null;
  read_at: string | null; archived_at: string | null; snoozed_until: string | null; created_at: string;
  issue: { id: string; number: number; title: string; status: string; team_id: string; identifier: string } | null;
  actor: { id: string; email: string } | null;
  /** 'system' = no actor (e.g. due_soon). Optional: older servers omit it. */
  kind?: 'system' | 'user';
};
export type InboxAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze';
export type InboxTab = 'all' | 'unread' | 'archived' | 'snoozed';
export const TABS: { id: InboxTab; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'archived', label: 'Archived' }, { id: 'snoozed', label: 'Snoozed' }];
export type PrefMap = Record<NotifType, { in_app: boolean; email: boolean }>;
export const NOTIF_TYPES: NotifType[] = ['assigned', 'mention', 'comment', 'status_change', 'due_soon'];

/** Snooze presets, computed from a given clock so they are testable. */
export function snoozePresets(now = new Date()): { id: string; label: string; until: string }[] {
  const at = (d: Date, h: number) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x; };
  const later = new Date(now.getTime() + 3 * 3600e3);
  const tomorrow = at(new Date(now.getTime() + 86400e3), 9);
  const mon = new Date(now); mon.setDate(mon.getDate() + (((8 - mon.getDay()) % 7) || 7));
  return [
    { id: 'later', label: 'Later today (3h)', until: later.toISOString() },
    { id: 'tomorrow', label: 'Tomorrow 9:00', until: tomorrow.toISOString() },
    { id: 'nextweek', label: 'Next Monday 9:00', until: at(mon, 9).toISOString() },
  ];
}
export interface InboxClient {
  list(tab?: InboxTab): Promise<{ items: Notif[]; unread_count: number }>;
  getPrefs(): Promise<PrefMap | null>;
  putPrefs(p: Partial<Record<NotifType, Partial<{ in_app: boolean; email: boolean }>>>): Promise<PrefMap | null>;
  unreadCount(): Promise<number>;
  act(id: string, action: InboxAction, until?: string): Promise<Notif | null>;
  readAll(): Promise<boolean>;
}

export const TYPE_LABEL: Record<NotifType, string> = { assigned: 'assigned you', mention: 'mentioned you', comment: 'commented', status_change: 'changed the status', due_soon: 'is due soon' };

export function httpInboxClient(slug: string, f: typeof fetch = fetch): InboxClient {
  const b = `/api/v1/w/${slug}/notifications`;
  return {
    async list(tab = 'all') {
      const qs = tab === 'unread' ? '&unread=true' : tab === 'archived' ? '&archived=true' : tab === 'snoozed' ? '&snoozed=true' : '';
      const r = await f(`${b}?limit=100${qs}`);
      if (!r.ok) throw new Error('list failed');
      const j = (await r.json()) as { items: Notif[]; unread_count: number };
      return { items: j.items, unread_count: j.unread_count };
    },
    async unreadCount() {
      try { const r = await f(`${b}/unread-count`); return r.ok ? ((await r.json()) as { unread_count: number }).unread_count : 0; } catch { return 0; }
    },
    async act(id, action, until) {
      try {
        const r = await f(`${b}/${id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: action === 'snooze' ? JSON.stringify({ until }) : undefined });
        return r.ok ? ((await r.json()) as Notif) : null;
      } catch { return null; }
    },
    async readAll() { try { return (await f(`${b}/read-all`, { method: 'POST' })).ok; } catch { return false; } },
    async getPrefs() {
      try { const r = await f(`/api/v1/w/${slug}/notification-preferences`); return r.ok ? ((await r.json()) as { preferences: PrefMap }).preferences : null; } catch { return null; }
    },
    async putPrefs(p) {
      try {
        const r = await f(`/api/v1/w/${slug}/notification-preferences`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preferences: p }) });
        return r.ok ? ((await r.json()) as { preferences: PrefMap }).preferences : null;
      } catch { return null; }
    },
  };
}

/** In-memory client with a small seed: lets the UI run and be tested without a database. */
export function mockInboxClient(): InboxClient {
  const now = Date.now();
  const mk = (n: number, type: NotifType, title: string, ago: number, read: boolean): Notif => ({
    id: `n${n}`, type, issue_id: `i${n}`, comment_id: null, actor_id: 'u2', read_at: read ? new Date(now - ago).toISOString() : null, archived_at: null, snoozed_until: null,
    created_at: new Date(now - ago).toISOString(), issue: { id: `i${n}`, number: n, title, status: 'todo', team_id: 't1', identifier: `DEL-${n}` }, actor: { id: 'u2', email: 'sam@example.com' },
  });
  let rows: Notif[] = [mk(1, 'assigned', 'Fix login redirect', 60e3, false), mk(2, 'comment', 'Board drag jitter', 3600e3, false), mk(3, 'status_change', 'Cron parser edge cases', 86400e3, true)];
  const isSnoozed = (n: Notif) => !!n.snoozed_until && new Date(n.snoozed_until).getTime() > Date.now();
  const active = () => rows.filter((n) => !n.archived_at && !isSnoozed(n));
  let prefs = Object.fromEntries(NOTIF_TYPES.map((t) => [t, { in_app: true, email: false }])) as PrefMap;
  const unread = () => active().filter((n) => !n.read_at).length;
  return {
    async list(tab = 'all') {
      const items = tab === 'archived' ? rows.filter((n) => n.archived_at) : tab === 'snoozed' ? rows.filter((n) => !n.archived_at && isSnoozed(n)) : tab === 'unread' ? active().filter((n) => !n.read_at) : active();
      return { items, unread_count: unread() };
    },
    async getPrefs() { return prefs; },
    async putPrefs(p) { for (const t of NOTIF_TYPES) if (p[t]) prefs = { ...prefs, [t]: { ...prefs[t], ...p[t] } }; return prefs; },
    async unreadCount() { return unread(); },
    async act(id, action, until) {
      const t = new Date().toISOString();
      rows = rows.map((n) => n.id !== id ? n : action === 'read' ? { ...n, read_at: n.read_at ?? t } : action === 'unread' ? { ...n, read_at: null }
        : action === 'archive' ? { ...n, archived_at: t, read_at: n.read_at ?? t } : action === 'unarchive' ? { ...n, archived_at: null } : { ...n, snoozed_until: until ?? null });
      return rows.find((n) => n.id === id) ?? null;
    },
    async readAll() { const t = new Date().toISOString(); rows = rows.map((n) => ({ ...n, read_at: n.read_at ?? t })); return true; },
  };
}

export function relTime(iso: string, nowMs = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}


/** Who did it: "Due soon" for system notifications (no actor), else "name <verb>". */
export function whoLabel(n: Notif): string {
  if (n.kind === 'system') return 'Due soon';
  return `${n.actor?.email.split('@')[0] ?? 'Someone'} ${TYPE_LABEL[n.type]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Short Linear-style timestamp: "just now", "5m ago", "3h ago", then "Oct 30, 10:00" (year added when not the current one). */
export function shortWhen(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  const s = Math.max(0, Math.round((nowMs - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const yr = d.getFullYear() === new Date(nowMs).getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${yr}, ${hm}`;
}

/** One row per issue: the latest notification represents the group; it is unread if any member is. */
export function groupByIssue(items: Notif[]): { rows: Notif[]; members: Map<string, Notif[]> } {
  const by = new Map<string, Notif[]>();
  for (const n of items) by.set(n.issue_id, [...(by.get(n.issue_id) ?? []), n]);
  const members = new Map<string, Notif[]>();
  const rows = [...by.values()].map((g) => {
    const latest = g.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
    const anyUnread = g.some((x) => !x.read_at);
    const row = { ...latest, read_at: anyUnread ? null : latest.read_at };
    members.set(row.id, g);
    return row;
  });
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return { rows, members };
}
