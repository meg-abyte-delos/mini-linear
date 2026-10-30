'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { PRIORITY_LABEL, STATUS_LABEL, type Issue } from '@/lib/issues';
import { TABS, TYPE_LABEL, relTime, snoozePresets, type InboxAction, type InboxClient, type InboxTab, type Notif } from '@/lib/inbox-client';

/**
 * Inbox. Two panes: notification list on the left, preview of the selected notification's issue on the right (no List/Board toggle).
 * Tabs All/Unread/Archived/Snoozed, bulk read/archive on checked rows.
 * Keys: j/k move, x check, e archive, u toggle read, s snooze menu (1-3 pick a preset), h snooze until tomorrow, Enter open issue, Esc closes menus.
 */
export function Inbox({ client, onUnread, onOpenIssue, getIssue, refreshKey = 0 }: { client: InboxClient; onUnread: (n: number) => void; onOpenIssue?: (issueId: string) => void; getIssue?: (issueId: string) => Issue | undefined; refreshKey?: number }) {
  const [tab, setTab] = useState<InboxTab>('all');
  const [items, setItems] = useState<Notif[] | null>(null);
  const [err, setErr] = useState(false);
  const [cur, setCur] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const r = await client.list(tab); setItems(r.items); onUnread(r.unread_count); setErr(false); setChecked(new Set()); } catch { setErr(true); }
  }, [client, onUnread, tab]);
  useEffect(() => { setItems(null); setCur(0); void load(); }, [load]);
  // Realtime: a change elsewhere may have produced a notification; reload quietly (keeps selection).
  const firstKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstKey.current) return;
    const t = setTimeout(() => { void client.list(tab).then((r) => { setItems(r.items); onUnread(r.unread_count); }).catch(() => undefined); }, 400);
    return () => clearTimeout(t);
  }, [refreshKey]);
  const list = items ?? [];
  const unread = list.filter((n) => !n.read_at).length;
  const presets = useMemo(() => snoozePresets(), [snoozeOpen]);
  const sel = list[cur] as Notif | undefined;
  const selIssue = sel?.issue ? getIssue?.(sel.issue_id) : undefined;
  // Targets of an action: the checked rows, else the focused row.
  const targets = (): Notif[] => (checked.size > 0 ? list.filter((n) => checked.has(n.id)) : sel ? [sel] : []);

  async function actMany(ns: Notif[], action: InboxAction, until?: string) {
    if (ns.length === 0) return;
    const prev = items ?? [];
    const ids = new Set(ns.map((n) => n.id));
    const t = new Date().toISOString();
    const leaves = action === 'archive' || action === 'snooze' || action === 'unarchive';
    // Optimistic update; the list is reloaded if any request fails.
    setItems(leaves ? prev.filter((x) => !ids.has(x.id)) : prev.map((x) => ids.has(x.id) ? { ...x, read_at: action === 'read' ? t : null } : x));
    setChecked(new Set());
    if (leaves) setCur((c) => Math.max(0, Math.min(c, prev.length - ids.size - 1)));
    const res = await Promise.all(ns.map((n) => client.act(n.id, action, until)));
    const failed = res.filter((r) => !r).length;
    if (failed) { setFail(`${failed} action${failed > 1 ? 's' : ''} failed`); await load(); } else setFail(null);
    onUnread(await client.unreadCount());
  }
  const act = (n: Notif, action: InboxAction, until?: string) => actMany([n], action, until);
  const open = (n: Notif) => { if (!n.read_at) void act(n, 'read'); onOpenIssue?.(n.issue_id); };
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role=dialog]')) return;
      if (e.key === 'Escape') { setSnoozeOpen(false); setChecked(new Set()); return; }
      if (snoozeOpen) {
        const p = presets[Number(e.key) - 1];
        if (p) { e.preventDefault(); setSnoozeOpen(false); void actMany(targets(), 'snooze', p.until); }
        return;
      }
      if (e.key === 'j') { setCur(Math.min(list.length - 1, cur + 1)); e.preventDefault(); }
      else if (e.key === 'k') { setCur(Math.max(0, cur - 1)); e.preventDefault(); }
      else if (sel && e.key === 'x') { e.preventDefault(); toggle(sel.id); }
      else if (sel && e.key === 'e') { e.preventDefault(); void actMany(targets(), tab === 'archived' ? 'unarchive' : 'archive'); }
      else if (sel && e.key === 's') { e.preventDefault(); setSnoozeOpen(true); }
      else if (sel && e.key === 'h') { e.preventDefault(); void actMany(targets(), 'snooze', presets[1]?.until); }
      else if (sel && e.key === 'u') { e.preventDefault(); const ns = targets(); void actMany(ns, ns.every((n) => n.read_at) ? 'unread' : 'read'); }
      else if (sel && e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); open(sel); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tabs = (
    <div role='tablist' aria-label='Inbox views' className='inbox-tabs'>
      {TABS.map((x) => <button key={x.id} role='tab' aria-selected={tab === x.id} className={tab === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>{x.label}</button>)}
    </div>
  );
  if (err) return <div className='state error' role='alert'><p>Could not load notifications.</p><button className='btn' onClick={() => void load()}>Retry</button></div>;
  if (!items) return <div className='state' role='status'><p>Loading…</p></div>;
  const empty = tab === 'all' ? { t: 'Inbox zero', h: 'Nothing needs your attention. Notifications about issues you follow land here.' } : tab === 'unread' ? { t: 'No unread notifications', h: 'You are all caught up.' } : tab === 'archived' ? { t: 'Nothing archived', h: 'Archived notifications show up here.' } : { t: 'Nothing snoozed', h: 'Snoozed notifications come back when their time is up.' };
  return (
    <div className='inbox-wrap'>
      <div className='scroll inbox'>
        {tabs}
        <div className='inbox-bar'>
          {checked.size > 0 ? (
            <span className='bulk' role='toolbar' aria-label='Bulk actions'>
              <span>{checked.size} selected</span>
              <button className='btn' data-size='24' onClick={() => void actMany(targets(), 'read')}>Mark read</button>
              <button className='btn' data-size='24' onClick={() => void actMany(targets(), 'unread')}>Mark unread</button>
              <button className='btn' data-size='24' onClick={() => void actMany(targets(), tab === 'archived' ? 'unarchive' : 'archive')}>{tab === 'archived' ? 'Unarchive' : 'Archive'}</button>
              <button className='btn' data-size='24' onClick={() => setSnoozeOpen(true)}>Snooze…</button>
              <button className='btn' data-size='24' onClick={() => setChecked(new Set())}>Clear</button>
            </span>
          ) : <span>{unread} unread</span>}
          {tab === 'all' && checked.size === 0 && <button className='btn' data-size='24' disabled={unread === 0} onClick={async () => { if (await client.readAll()) { await load(); } }}>Mark all as read</button>}
        </div>
        {snoozeOpen && (
          <div className='snooze-menu' role='menu' aria-label='Snooze until'>
            {presets.map((p, i) => <button key={p.id} role='menuitem' onClick={() => { setSnoozeOpen(false); void actMany(targets(), 'snooze', p.until); }}>{p.label} <kbd>{i + 1}</kbd></button>)}
            <button role='menuitem' onClick={() => setSnoozeOpen(false)}>Cancel</button>
          </div>
        )}
        {fail && <p role='alert' className='toast'>{fail}</p>}
        {list.length === 0 ? <EmptyState icon='inbox' title={empty.t} hint={empty.h} /> : (
          <ul role='listbox' aria-label='Notifications'>
            {list.map((n, i) => (
              <li key={n.id} role='option' aria-selected={i === cur} data-unread={n.read_at ? undefined : 'true'} className={`nrow${i === cur ? ' sel' : ''}${n.read_at ? '' : ' unread'}`} onClick={() => setCur(i)} onDoubleClick={() => open(n)}>
                <span className={`rowsel${checked.has(n.id) ? ' on' : ''}`} aria-hidden='true' data-testid={`select-${n.issue?.identifier ?? n.id}`} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}>{checked.has(n.id) ? '☑' : '☐'}</span>
                <span className='ndot' aria-label={n.read_at ? 'Read' : 'Unread'} />
                <span className='nav-av' aria-hidden='true'>{(n.actor?.email ?? 's').charAt(0)}</span>
                <span className='nid'>{n.issue?.identifier ?? 'Deleted'}</span>
                <span className='ntitle'>{n.issue?.title ?? ''}</span>
                <span className='nwho'>{n.actor?.email.split('@')[0] ?? 'Someone'} {TYPE_LABEL[n.type]}</span>
                <span className='ntime'>{relTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sel && (
        <aside className='inbox-detail' aria-label='Notification detail'>
          <h2>{sel.issue ? `${sel.issue.identifier} ${sel.issue.title}` : 'Issue deleted'}</h2>
          <dl>
            <dt>Event</dt><dd>{sel.actor?.email.split('@')[0] ?? 'Someone'} {TYPE_LABEL[sel.type]}</dd>
            {sel.issue && <><dt>Status</dt><dd>{sel.issue.status}</dd></>}
            <dt>When</dt><dd>{new Date(sel.created_at).toLocaleString()}</dd>
            {sel.snoozed_until && <><dt>Snoozed until</dt><dd>{new Date(sel.snoozed_until).toLocaleString()}</dd></>}
          </dl>
          {selIssue && (
            <section className='inbox-preview' aria-label='Issue preview'>
              <p className='inbox-preview-meta'>{PRIORITY_LABEL[selIssue.priority]} · {STATUS_LABEL[selIssue.status]}</p>
              <Markdown source={selIssue.description} />
            </section>
          )}
          <div className='inbox-detail-actions' role='toolbar' aria-label='Notification actions'>
            <button className='btn' data-variant='ghost' aria-label={`${tab === 'archived' ? 'Unarchive' : 'Archive'} ${sel.issue?.identifier ?? ''}`} onClick={() => void act(sel, tab === 'archived' ? 'unarchive' : 'archive')}>{tab === 'archived' ? 'Unarchive' : 'Archive'}</button>
            <button className='btn' data-variant='ghost' aria-label={`Snooze ${sel.issue?.identifier ?? ''}`} onClick={() => setSnoozeOpen(true)}>Snooze</button>
            <button className='btn' data-variant='ghost' aria-label={`Mark ${sel.issue?.identifier ?? ''} ${sel.read_at ? 'unread' : 'read'}`} onClick={() => void act(sel, sel.read_at ? 'unread' : 'read')}>{sel.read_at ? 'Mark unread' : 'Mark read'}</button>
            {sel.issue && <button className='btn' onClick={() => open(sel)}>Open issue</button>}
          </div>
        </aside>
      )}
    </div>
  );
}
