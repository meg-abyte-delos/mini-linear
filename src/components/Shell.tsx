'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, LABELS, fmtDate, type Issue, type Status } from '@/lib/issues';
import { Avatar, Icon, PriorityIcon, StatusIcon } from '@/components/icons';
import { fuzzyFilter } from '@/lib/fuzzy';

type View = 'list' | 'board';
interface Cmd { id: string; label: string; hint?: string; run: () => void }

export function Shell({ initialIssues }: { initialIssues: Issue[] }) {
  const [issues, setIssues] = useState(initialIssues);
  const [view, setView] = useState<View>('list');
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');
  const [pi, setPi] = useState(0);

  const ordered = useMemo(() => STATUSES.flatMap((s) => issues.filter((i) => i.status === s)), [issues]);
  const current = ordered[sel];

  function cycleStatus() {
    if (!current) return;
    const next = STATUSES[(STATUSES.indexOf(current.status) + 1) % STATUSES.length] as Status;
    setIssues((all) => all.map((i) => (i.id === current.id ? { ...i, status: next, version: i.version + 1 } : i)));
  }
  function create() {
    const n = issues.length + 1;
    setIssues((all) => [
      ...all,
      { id: `DEL-${n}`, title: `New issue ${n}`, description: '', status: 'todo', priority: 0, assignee_id: null, project_id: null, cycle_id: null, label_ids: [], parent_id: null, sort_key: String(n).padStart(4, '0'), version: 1, created_at: new Date().toISOString() },
    ]);
  }
  function openPalette() { setPalette(true); setQ(''); setPi(0); }

  const commands: Cmd[] = [
    { id: 'create', label: 'Create issue', hint: 'C', run: create },
    { id: 'list', label: 'Go to list view', run: () => setView('list') },
    { id: 'board', label: 'Go to board view', run: () => setView('board') },
    { id: 'status', label: 'Change status of selected issue', hint: 'S', run: cycleStatus },
    { id: 'open', label: 'Open selected issue', hint: '↵', run: () => setOpen(true) },
  ];
  const results = fuzzyFilter(commands, q, (c) => c.label);
  const actions = useRef({ create, cycleStatus });
  useEffect(() => { actions.current = { create, cycleStatus }; });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPalette((p) => !p); setQ(''); setPi(0); return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') setPalette(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { setOpen(false); setPalette(false); }
      else if (k === 'j') setSel((s) => Math.min(s + 1, ordered.length - 1));
      else if (k === 'k') setSel((s) => Math.max(s - 1, 0));
      else if (e.key === 'Enter') setOpen(true);
      else if (k === 'c') { e.preventDefault(); actions.current.create(); }
      else if (k === 's') actions.current.cycleStatus();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered.length]);

  const who = (id: string | null) => USERS.find((u) => u.id === id);
  const assignee = (i: Issue) => { const u = who(i.assignee_id); return u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av av-none' aria-hidden='true' />; };
  const select = (i: Issue, openPanel: boolean) => { setSel(ordered.findIndex((x) => x.id === i.id)); if (openPanel) setOpen(true); };

  const row = (i: Issue) => (
    <div key={i.id} role='option' tabIndex={-1} aria-selected={current?.id === i.id} className='row' onClick={() => select(i, true)}>
      <PriorityIcon priority={i.priority} />
      <span className='id'>{i.id}</span>
      <StatusIcon status={i.status} />
      <span className='title'>{i.title}</span>
      <span className='labels'>{i.label_ids.map((l) => { const lb = LABELS.find((x) => x.id === l); return lb ? <span key={l} className={`chip ${lb.hue}`}>{lb.name}</span> : null; })}</span>
      <span className='date'>{fmtDate(i.created_at)}</span>
      {assignee(i)}
    </div>
  );
  const card = (i: Issue) => (
    <div key={i.id} role='option' tabIndex={-1} aria-selected={current?.id === i.id} className='card' onClick={() => select(i, true)}>
      <div className='card-top'><span className='id'>{i.id}</span>{assignee(i)}</div>
      <div className='card-title'>{i.title}</div>
      <div className='card-meta'><PriorityIcon priority={i.priority} /></div>
    </div>
  );

  return (
    <div className='shell'>
      <aside className='side' aria-label='Sidebar'>
        <div className='ws'><span className='ws-logo' aria-hidden='true'>D</span><span className='ws-name'>Delos</span></div>
        <button className='side-btn new' onClick={create}><Icon name='plus' /><span>New issue</span><kbd>C</kbd></button>
        <button className='side-btn' onClick={openPalette} aria-label='Open command palette'><Icon name='search' /><span>Search</span><kbd>⌘K</kbd></button>
        <nav aria-label='Primary'>
          <a className='side-link' href='#inbox' onClick={(e) => e.preventDefault()}><Icon name='inbox' /><span>Inbox</span></a>
          <a className='side-link' href='#my-issues' onClick={(e) => e.preventDefault()}><Icon name='issues' /><span>My issues</span></a>
          <a className='side-link' href='#views' onClick={(e) => e.preventDefault()}><Icon name='views' /><span>Views</span></a>
        </nav>
        <div className='side-label'>Your teams</div>
        <nav aria-label='Teams'>
          <a className='side-link' href='#team' onClick={(e) => e.preventDefault()}><Icon name='team' /><span>Delos</span></a>
          <a className='side-link sub active' aria-current='page' href='#issues' onClick={(e) => e.preventDefault()}><span>Issues</span></a>
          <a className='side-link sub' href='#cycles' onClick={(e) => e.preventDefault()}><span>Cycles</span></a>
          <a className='side-link sub' href='#projects' onClick={(e) => e.preventDefault()}><span>Projects</span></a>
        </nav>
      </aside>
      <main className='main'>
        <header className='head'>
          <div className='crumbs'><span>Delos</span><span className='sep'>/</span><strong>Issues</strong><span className='count'>{issues.length}</span></div>
          <div className='switch' role='group' aria-label='View'>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name='list' /><span>List</span></button>
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name='board' /><span>Board</span></button>
          </div>
        </header>
        {issues.length === 0 ? (
          <p className='empty'>No issues yet. Press C to create one.</p>
        ) : view === 'list' ? (
          <div className='scroll' role='listbox' aria-label='Issue list'>
            {STATUSES.map((s) => {
              const items = issues.filter((i) => i.status === s);
              if (!items.length) return null;
              return (
                <section key={s} className='group' aria-label={STATUS_LABEL[s]}>
                  <h2><StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{items.length}</span></h2>
                  {items.map(row)}
                </section>
              );
            })}
          </div>
        ) : (
          <div className='board' role='listbox' aria-label='Issue board'>
            {STATUSES.map((s) => (
              <section key={s} className='col' aria-label={STATUS_LABEL[s]}>
                <h2><StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{issues.filter((i) => i.status === s).length}</span></h2>
                {issues.filter((i) => i.status === s).map(card)}
              </section>
            ))}
          </div>
        )}
      </main>
      {open && current && (
        <aside className='panel' aria-label='Issue detail'>
          <div className='panel-head'><span className='id'>{current.id}</span><button onClick={() => setOpen(false)} aria-label='Close detail panel'>Esc</button></div>
          <h2>{current.title}</h2>
          <dl>
            <dt>Status</dt><dd><StatusIcon status={current.status} />{STATUS_LABEL[current.status]}</dd>
            <dt>Priority</dt><dd><PriorityIcon priority={current.priority} />{PRIORITY_LABEL[current.priority]}</dd>
            <dt>Assignee</dt><dd>{assignee(current)}{who(current.assignee_id)?.name ?? 'Unassigned'}</dd>
          </dl>
        </aside>
      )}
      {palette && (
        <div className='overlay' onClick={() => setPalette(false)}>
          <div className='palette' role='dialog' aria-modal='true' aria-label='Command palette' onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus aria-label='Search commands' placeholder='Type a command or search…' value={q}
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((p) => Math.min(p + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((p) => Math.max(p - 1, 0)); }
                else if (e.key === 'Enter') { results[pi]?.run(); setPalette(false); }
              }}
            />
            <ul role='listbox' aria-label='Commands'>
              {results.map((c, idx) => (
                <li key={c.id} role='option' aria-selected={idx === pi} onClick={() => { c.run(); setPalette(false); }}><span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}</li>
              ))}
              {results.length === 0 && <li role='option' aria-selected='false'>No matching command</li>}
            </ul>
            <div className='palette-foot'><kbd>↑↓</kbd> navigate <kbd>↵</kbd> run <kbd>esc</kbd> close</div>
          </div>
        </div>
      )}
    </div>
  );
}
