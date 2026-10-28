'use client';
import { useCallback, useEffect, useState } from 'react';
import { TYPE_LABEL, relTime, type InboxAction, type InboxClient, type Notif } from '@/lib/inbox-client';

/** Inbox list. Keys: j/k move, e archive, h snooze until tomorrow 9:00, u toggle read, Enter open issue. */
export function Inbox({ client, onUnread, onOpenIssue }: { client: InboxClient; onUnread: (n: number) => void; onOpenIssue?: (issueId: string) => void }) {
  const [items, setItems] = useState<Notif[] | null>(null);
  const [err, setErr] = useState(false);
  const [cur, setCur] = useState(0);
  const load = useCallback(async () => {
    try { const r = await client.list(); setItems(r.items); onUnread(r.unread_count); setErr(false); } catch { setErr(true); }
  }, [client, onUnread]);
  useEffect(() => { void load(); }, [load]);
  const unread = (items ?? []).filter((n) => !n.read_at).length;

  async function act(n: Notif, action: InboxAction, until?: string) {
    const prev = items ?? [];
    const t = new Date().toISOString();
    // Optimistic: archive and snooze drop the row; read/unread flip it. Rolled back if the server refuses.
    setItems(action === 'archive' || action === 'snooze' ? prev.filter((x) => x.id !== n.id) : prev.map((x) => x.id === n.id ? { ...x, read_at: action === 'read' ? t : null } : x));
    const r = await client.act(n.id, action, until);
    if (!r) { setItems(prev); return; }
    onUnread(await client.unreadCount());
  }
  const tomorrow9 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('[role=dialog]')) return;
      const list = items ?? [];
      const n = list[cur];
      if (e.key === 'j') { setCur(Math.min(list.length - 1, cur + 1)); e.preventDefault(); }
      else if (e.key === 'k') { setCur(Math.max(0, cur - 1)); e.preventDefault(); }
      else if (n && e.key === 'e') { e.preventDefault(); void act(n, 'archive'); setCur(Math.max(0, Math.min(cur, list.length - 2))); }
      else if (n && e.key === 'h') { e.preventDefault(); void act(n, 'snooze', tomorrow9()); setCur(Math.max(0, Math.min(cur, list.length - 2))); }
      else if (n && e.key === 'u') { e.preventDefault(); void act(n, n.read_at ? 'unread' : 'read'); }
      else if (n && e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); void act(n, 'read'); onOpenIssue?.(n.issue_id); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (err) return <div className='state error' role='alert'><p>Could not load notifications.</p><button onClick={() => void load()}>Retry</button></div>;
  if (!items) return <div className='state' role='status'><p>Loading…</p></div>;
  if (items.length === 0) return <div className='state empty' role='status'><p>Inbox zero. Nothing needs your attention.</p></div>;
  return (
    <div className='scroll inbox'>
      <div className='inbox-bar'>
        <span>{unread} unread</span>
        <button disabled={unread === 0} onClick={async () => { if (await client.readAll()) { await load(); } }}>Mark all as read</button>
      </div>
      <ul role='listbox' aria-label='Notifications'>
        {items.map((n, i) => (
          <li key={n.id} role='option' aria-selected={i === cur} data-unread={n.read_at ? undefined : 'true'} className={`nrow${i === cur ? ' sel' : ''}${n.read_at ? '' : ' unread'}`} onClick={() => setCur(i)} onDoubleClick={() => { void act(n, 'read'); onOpenIssue?.(n.issue_id); }}>
            <span className='ndot' aria-label={n.read_at ? 'Read' : 'Unread'} />
            <span className='nid'>{n.issue?.identifier ?? 'Deleted'}</span>
            <span className='ntitle'>{n.issue?.title ?? ''}</span>
            <span className='nwho'>{n.actor?.email.split('@')[0] ?? 'Someone'} {TYPE_LABEL[n.type]}</span>
            <span className='ntime'>{relTime(n.created_at)}</span>
            <span className='nact'>
              <button aria-label={`Archive ${n.issue?.identifier ?? ''}`} onClick={(e) => { e.stopPropagation(); void act(n, 'archive'); }}>Archive</button>
              <button aria-label={`Snooze ${n.issue?.identifier ?? ''}`} onClick={(e) => { e.stopPropagation(); void act(n, 'snooze', tomorrow9()); }}>Snooze</button>
              <button aria-label={`Mark ${n.issue?.identifier ?? ''} ${n.read_at ? 'unread' : 'read'}`} onClick={(e) => { e.stopPropagation(); void act(n, n.read_at ? 'unread' : 'read'); }}>{n.read_at ? 'Unread' : 'Read'}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
