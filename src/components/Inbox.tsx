'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { IssueActivity } from '@/components/IssueDetail';
import '@/app/ui-inbox-activity.css';
import { Avatar, PriorityIcon, StatusIcon } from '@/components/icons';
import { hueFor, initialsOf } from '@/lib/member-hue';
import { personName } from '@/lib/nl-people';
import { PRIORITY_LABEL, STATUS_LABEL, type Issue, type Status } from '@/lib/issues';
import { TABS, groupByIssue, relTime, shortWhen, whoLabel, snoozePresets, type InboxAction, type InboxClient, type InboxTab, type Notif } from '@/lib/inbox-client';

/**
 * Inbox. Two panes: notification list on the left, preview of the selected notification's issue on the right (no List/Board toggle).
 * Tabs All/Unread/Archived/Snoozed, bulk read/archive on checked rows.
 * Keys: j/k move, x check, e archive, u toggle read, s snooze menu (1-3 pick a preset), h snooze until tomorrow, Enter open issue, Esc closes menus.
 */
/** Optional name lookups so the detail pane can show properties like Linear's issue sidebar. */
export interface InboxLookup { person: (id: string | null) => string | undefined; label: (id: string) => { name: string; hue: string } | undefined; project: (id: string | null) => string | undefined }

export function Inbox({ client, onUnread, onOpenIssue, getIssue, lookup, slug, refreshKey = 0, readOnly = false }: { client: InboxClient; readOnly?: boolean; onUnread: (n: number) => void; onOpenIssue?: (issueId: string) => void; getIssue?: (issueId: string) => Issue | undefined; lookup?: InboxLookup; slug?: string; refreshKey?: number }) {
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
  // One row per issue (latest event); the unread count is the number of unread rows, i.e. the dots.
  const { rows: list, members } = useMemo(() => groupByIssue(items ?? []), [items]);
  const unread = list.filter((n) => !n.read_at).length;
  const presets = useMemo(() => snoozePresets(), [snoozeOpen]);
  const sel = list[cur] as Notif | undefined;
  const selIssue = sel?.issue ? getIssue?.(sel.issue_id) : undefined;
  // Targets of an action: the checked rows, else the focused row.
  const targets = (): Notif[] => (checked.size > 0 ? list.filter((n) => checked.has(n.id)) : sel ? [sel] : []);

  async function actMany(ns: Notif[], action: InboxAction, until?: string) {
    if (ns.length === 0) return;
    const prev = items ?? [];
    const all = ns.flatMap((n) => members.get(n.id) ?? [n]); // an action on a row applies to every event of its issue
    const ids = new Set(all.map((n) => n.id));
    const t = new Date().toISOString();
    const leaves = action === 'archive' || action === 'snooze' || action === 'unarchive';
    // Optimistic update; the list is reloaded if any request fails.
    setItems(leaves ? prev.filter((x) => !ids.has(x.id)) : prev.map((x) => ids.has(x.id) ? { ...x, read_at: action === 'read' ? t : null } : x));
    setChecked(new Set());
    if (leaves) setCur((c) => Math.max(0, Math.min(c, list.length - ns.length - 1)));
    const res = await Promise.all(all.map((n) => client.act(n.id, action, until)));
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
                {n.actor ? <Avatar initials={initialsOf(personName(n.actor))} hue={hueFor(n.actor.id)} /> : <span className='nav-av' aria-hidden='true' data-kind='system' title='Due date reminder'><svg viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round'><rect x='2.5' y='3.5' width='11' height='10' rx='2' /><path d='M2.5 6.5h11M5.5 2v3M10.5 2v3M8 8.5v2l1.3.8' /></svg></span>}
                <span className='nmain'>
                  <span className='ntitle' title={n.issue?.title ?? ''}>{n.issue?.title ?? ''}</span>
                  <span className='nsub'>
                    {n.issue && <span className='nstatus' data-status={n.issue.status} title={STATUS_LABEL[n.issue.status as Status] ?? n.issue.status}><StatusIcon status={n.issue.status as Status} /></span>}
                    <span className='nid'>{n.issue?.identifier ?? 'Deleted'}</span>
                    <span className='nsep' aria-hidden='true'>·</span>
                    <span className='nwho' title={whoLabel(n)}>{whoLabel(n)}</span>
                  </span>
                </span>
                <span className='ntime'>{relTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sel && (
        <aside className='inbox-detail' aria-label='Notification detail'>
          <div className='idp-bar'>
            <span className='idp-id'>{sel.issue?.identifier ?? 'Deleted'}</span>
            <div className='inbox-detail-actions' role='toolbar' aria-label='Notification actions'>
              {sel.issue && <button className='btn' data-variant='primary' onClick={() => open(sel)}>Open issue</button>}
              <button className='btn' data-variant='ghost' aria-label={`Mark ${sel.issue?.identifier ?? ''} ${sel.read_at ? 'unread' : 'read'}`} onClick={() => void act(sel, sel.read_at ? 'unread' : 'read')}>{sel.read_at ? 'Mark unread' : 'Mark read'}</button>
              <button className='btn' data-variant='ghost' aria-label={`Snooze ${sel.issue?.identifier ?? ''}`} onClick={() => setSnoozeOpen(true)}>Snooze</button>
              <button className='btn' data-variant='ghost' aria-label={`${tab === 'archived' ? 'Unarchive' : 'Archive'} ${sel.issue?.identifier ?? ''}`} onClick={() => void act(sel, tab === 'archived' ? 'unarchive' : 'archive')}>{tab === 'archived' ? 'Unarchive' : 'Archive'}</button>
            </div>
          </div>
          <div className='idp-body'>
            <article className='idp-main'>
              <h2 title={sel.issue ? `${sel.issue.identifier} ${sel.issue.title}` : undefined}>{sel.issue ? sel.issue.title : 'Issue deleted'}</h2>
              <p className='idp-event'>{whoLabel(sel)} <span aria-hidden='true'>·</span> <span title={new Date(sel.created_at).toLocaleString()}>{relTime(sel.created_at)}</span></p>
              {selIssue && (
                <section className='inbox-preview' aria-label='Issue preview'>
                  {selIssue.description.trim() ? <Markdown source={selIssue.description} /> : <p className='md-empty'>No description.</p>}
                </section>
              )}
              {slug && sel.issue && <IssueActivity key={sel.issue_id} slug={slug} issueId={sel.issue_id} identifier={sel.issue.identifier} readOnly={readOnly} />}
            </article>
            <dl className='idp-props' aria-label='Properties'>
              {sel.issue && <><dt>Status</dt><dd><span className='pill inbox-status' data-status={sel.issue.status}><StatusIcon status={sel.issue.status as Status} />{STATUS_LABEL[sel.issue.status as Status] ?? sel.issue.status}</span></dd></>}
              {selIssue && <><dt>Priority</dt><dd><span className='idp-val'><PriorityIcon priority={selIssue.priority} />{PRIORITY_LABEL[selIssue.priority]}</span></dd></>}
              {selIssue && lookup && <><dt>Assignee</dt><dd>{lookup.person(selIssue.assignee_id) ?? 'Unassigned'}</dd></>}
              {selIssue && lookup && selIssue.label_ids.length > 0 && <><dt>Labels</dt><dd className='idp-labels'>{selIssue.label_ids.map((l) => { const lb = lookup.label(l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</dd></>}
              {selIssue && lookup && <><dt>Project</dt><dd>{lookup.project(selIssue.project_id) ?? 'No project'}</dd></>}
              <dt>Event</dt><dd>{whoLabel(sel)}</dd>
              <dt>When</dt><dd title={new Date(sel.created_at).toLocaleString()}>{shortWhen(sel.created_at)}</dd>
              {sel.snoozed_until && <><dt>Snoozed until</dt><dd>{shortWhen(sel.snoozed_until)}</dd></>}
            </dl>
          </div>
        </aside>
      )}
    </div>
  );
}
