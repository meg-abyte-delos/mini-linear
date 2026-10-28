// Inbox data access behind one interface: HTTP (API mode) or in-memory (mock mode, used by the e2e suite).
export type NotifType = 'assigned' | 'mention' | 'comment' | 'status_change' | 'due_soon';
export type Notif = {
  id: string; type: NotifType; issue_id: string; comment_id: string | null; actor_id: string | null;
  read_at: string | null; archived_at: string | null; snoozed_until: string | null; created_at: string;
  issue: { id: string; number: number; title: string; status: string; team_id: string; identifier: string } | null;
  actor: { id: string; email: string } | null;
};
export type InboxAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'snooze';
export interface InboxClient {
  list(): Promise<{ items: Notif[]; unread_count: number }>;
  unreadCount(): Promise<number>;
  act(id: string, action: InboxAction, until?: string): Promise<Notif | null>;
  readAll(): Promise<boolean>;
}

export const TYPE_LABEL: Record<NotifType, string> = { assigned: 'assigned you', mention: 'mentioned you', comment: 'commented', status_change: 'changed the status', due_soon: 'is due soon' };

export function httpInboxClient(slug: string, f: typeof fetch = fetch): InboxClient {
  const b = `/api/v1/w/${slug}/notifications`;
  return {
    async list() {
      const r = await f(`${b}?limit=100`);
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
  const active = () => rows.filter((n) => !n.archived_at && !(n.snoozed_until && new Date(n.snoozed_until).getTime() > Date.now()));
  const unread = () => active().filter((n) => !n.read_at).length;
  return {
    async list() { return { items: active(), unread_count: unread() }; },
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
