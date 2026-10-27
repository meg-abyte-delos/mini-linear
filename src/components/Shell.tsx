'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, USERS, LABELS, fmtDate, type Issue, type Status } from '@/lib/issues';
import { Avatar, Icon, PriorityIcon, StatusIcon } from '@/components/icons';
import { fuzzyFilter } from '@/lib/fuzzy';
import { createStore } from '@/lib/mock-api';
import { Picker, type PickOption } from '@/components/Picker';

type View = 'list' | 'board';
type PickKind = 'priority' | 'assignee' | 'label';
interface Cmd { id: string; label: string; hint?: string; run: () => void }

export function Shell({ initialIssues }: { initialIssues: Issue[] }) {
  const [storeInst] = useState(() => createStore(initialIssues));
  const store = useRef(storeInst);
  // The store is the single source of truth; React state is a snapshot refreshed after each mutation.
  const [issues, setIssues] = useState(() => store.current.list());
  const sync = () => setIssues(store.current.list());
  const [view, setView] = useState<View>('list');
  const [selId, setSelId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');
  const [pi, setPi] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [pick, setPick] = useState<{ kind: PickKind; id: string; rect: DOMRect | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const ordered = useMemo(() => STATUSES.flatMap((s) => issues.filter((i) => i.status === s)), [issues]);
  const current = ordered.find((i) => i.id === selId) ?? ordered[0];
  const orderedRef = useRef(ordered);
  const currentIdRef = useRef<string | undefined>(current?.id);

  function cycleStatus() {
    if (!current) return;
    const next = STATUSES[(STATUSES.indexOf(current.status) + 1) % STATUSES.length] as Status;
    store.current.update(current.id, { status: next });
    sync();
  }
  // Drag and drop: drop on a section sets its status (appended); drop on a row/card inserts before it.
  function moveTo(id: string, status: Status, beforeId: string | null) {
    store.current.move(id, status, beforeId);
    sync();
    setSelId(id);
  }
  const dragProps = (i: Issue) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('text/plain', i.id); e.dataTransfer.effectAllowed = 'move'; dragRef.current = i.id; setDragId(i.id); },
    onDragEnd: () => { dragRef.current = null; setDragId(null); setOverKey(null); },
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); e.stopPropagation(); setOverKey(i.id); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); e.stopPropagation(); moveTo(d, i.status, i.id); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  const zoneProps = (s: Status) => ({
    onDragOver: (e: React.DragEvent) => { if (dragRef.current) { e.preventDefault(); setOverKey(`z-${s}`); } },
    onDrop: (e: React.DragEvent) => { const d = dragRef.current; if (!d) return; e.preventDefault(); moveTo(d, s, null); dragRef.current = null; setDragId(null); setOverKey(null); },
  });
  function openPick(kind: PickKind) {
    const id = currentIdRef.current; if (!id) return;
    const rect = document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.getBoundingClientRect() ?? null;
    setPick({ kind, id, rect });
  }
  function closePick() {
    const id = pick?.id; setPick(null);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus(), 0);
  }
  function applyPick(optId: string) {
    if (!pick) return;
    const cur = store.current.list().find((x) => x.id === pick.id); if (!cur) return;
    if (pick.kind === 'priority') { store.current.update(cur.id, { priority: Number(optId) as Issue['priority'] }); sync(); closePick(); }
    else if (pick.kind === 'assignee') { store.current.update(cur.id, { assignee_id: optId === 'none' ? null : optId }); sync(); closePick(); }
    else { store.current.update(cur.id, { label_ids: cur.label_ids.includes(optId) ? cur.label_ids.filter((l) => l !== optId) : [...cur.label_ids, optId] }); sync(); }
  }
  function pickOptions(): PickOption[] {
    const cur = pick && issues.find((x) => x.id === pick.id);
    if (!pick || !cur) return [];
    if (pick.kind === 'priority') return PRIORITY_LABEL.map((l, n) => ({ id: String(n), label: l, lead: <PriorityIcon priority={n as Issue['priority']} /> }));
    if (pick.kind === 'assignee') return [{ id: 'none', label: 'Unassigned', lead: <span className='av av-none' aria-hidden='true' /> }, ...USERS.map((u) => ({ id: u.id, label: u.name, lead: <Avatar initials={u.initials} hue={u.hue} /> }))];
    return LABELS.map((l) => ({ id: l.id, label: l.name, checked: cur.label_ids.includes(l.id), lead: <span className={`chip ${l.hue}`} aria-hidden='true'>&nbsp;</span> }));
  }
  function create() {
    store.current.create({ title: 'New issue' });
    sync();
  }
  function openPalette() { returnFocus.current = document.activeElement as HTMLElement | null; setPalette(true); setQ(''); setPi(0); }
  function closePalette() { setPalette(false); const el = returnFocus.current; returnFocus.current = null; if (el && document.contains(el)) setTimeout(() => el.focus(), 0); }

  const commands: Cmd[] = [
    { id: 'create', label: 'Create issue', hint: 'C', run: create },
    { id: 'list', label: 'Go to list view', run: () => setView('list') },
    { id: 'board', label: 'Go to board view', run: () => setView('board') },
    { id: 'status', label: 'Change status of selected issue', hint: 'S', run: cycleStatus },
    ...STATUSES.map((st) => ({ id: `move-${st}`, label: `Move to ${STATUS_LABEL[st]}`, run: () => { if (currentIdRef.current) moveTo(currentIdRef.current, st, null); } })),
    { id: 'set-priority', label: 'Set priority…', hint: 'P', run: () => setTimeout(() => openPick('priority'), 0) },
    { id: 'set-assignee', label: 'Set assignee…', hint: 'A', run: () => setTimeout(() => openPick('assignee'), 0) },
    { id: 'set-label', label: 'Set label…', hint: 'L', run: () => setTimeout(() => openPick('label'), 0) },
    { id: 'open', label: 'Open selected issue', hint: '↵', run: () => setOpen(true) },
  ];
  const results = fuzzyFilter(commands, q, (c) => c.label);
  const actions = useRef({ create, cycleStatus, closePalette, openPalette, openPick });
  const paletteOpen = useRef(false);
  useEffect(() => { orderedRef.current = ordered; currentIdRef.current = current?.id; actions.current = { create, cycleStatus, closePalette, openPalette, openPick }; paletteOpen.current = palette; });
  // Roving focus: when focus is inside the issue collection, follow the selection.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || !current || !root.contains(document.activeElement) || document.activeElement === document.body) return;
    const el = root.querySelector<HTMLElement>(`[data-id="${current.id}"]`);
    if (el && el !== document.activeElement && (document.activeElement as HTMLElement).getAttribute('role') === 'option') el.focus();
  }, [current]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); if (paletteOpen.current) actions.current.closePalette(); else actions.current.openPalette(); return;
      }
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'Escape' && paletteOpen.current) actions.current.closePalette();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') { setOpen(false); if (paletteOpen.current) actions.current.closePalette(); }
      else if (k === 'j' || k === 'k') {
        const list = orderedRef.current; if (!list.length) return;
        const idx = Math.max(0, list.findIndex((i) => i.id === currentIdRef.current));
        const n = Math.min(Math.max(idx + (k === 'j' ? 1 : -1), 0), list.length - 1);
        setSelId(list[n]!.id);
      }
      else if (e.key === 'Enter') { if (!t.closest('button, a, [role="button"], select')) setOpen(true); }
      else if (k === 'c') { e.preventDefault(); actions.current.create(); }
      else if (k === 's') actions.current.cycleStatus();
      else if (k === 'p') { e.preventDefault(); actions.current.openPick('priority'); }
      else if (k === 'a') { e.preventDefault(); actions.current.openPick('assignee'); }
      else if (k === 'l') { e.preventDefault(); actions.current.openPick('label'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const who = (id: string | null) => USERS.find((u) => u.id === id);
  const assignee = (i: Issue) => { const u = who(i.assignee_id); return u ? <Avatar initials={u.initials} hue={u.hue} /> : <span className='av av-none' aria-hidden='true' />; };
  const select = (i: Issue, openPanel: boolean) => { setSelId(i.id); if (openPanel) setOpen(true); };

  const row = (i: Issue) => (
    <div key={i.id} role='option' data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} className={`row${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
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
    <div key={i.id} role='option' data-id={i.id} tabIndex={current?.id === i.id ? 0 : -1} aria-selected={current?.id === i.id} className={`card${dragId === i.id ? ' dragging' : ''}${overKey === i.id ? ' over' : ''}`} {...dragProps(i)} onClick={() => select(i, true)}>
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
        <button className='side-btn' onClick={openPalette} aria-keyshortcuts='Meta+K Control+K'><Icon name='search' /><span>Search</span><kbd>⌘K</kbd></button>
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
      <main className='main' ref={mainRef}>
        <header className='head'>
          <div className='crumbs'><span>Delos</span><span className='sep'>/</span><h1 className='crumb-title'>Issues</h1><span className='count'>{issues.length}</span></div>
          <div className='switch' role='group' aria-label='View'>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name='list' /><span>List</span></button>
            <button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name='board' /><span>Board</span></button>
          </div>
        </header>
        {issues.length === 0 ? (
          <p className='empty'>No issues yet. Press C to create one.</p>
        ) : view === 'list' ? (
          <div className='scroll'>
            {STATUSES.map((s) => {
              const items = issues.filter((i) => i.status === s);
              if (!items.length) return null;
              return (
                <section key={s} className={`group${overKey === `z-${s}` ? ' over-zone' : ''}`} aria-labelledby={`g-${s}`} {...zoneProps(s)}>
                  <h2 id={`g-${s}`}><StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{items.length}</span></h2>
                  <div role='listbox' aria-labelledby={`g-${s}`}>{items.map(row)}</div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className='board'>
            {STATUSES.map((s) => (
              <section key={s} className={`col${overKey === `z-${s}` ? ' over-zone' : ''}`} aria-labelledby={`c-${s}`} {...zoneProps(s)}>
                <h2 id={`c-${s}`}><StatusIcon status={s} /><span>{STATUS_LABEL[s]}</span><span className='count'>{issues.filter((i) => i.status === s).length}</span></h2>
                <div role='listbox' aria-labelledby={`c-${s}`}>{issues.filter((i) => i.status === s).map(card)}</div>
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
            <dt>Labels</dt><dd>{current.label_ids.length ? current.label_ids.map((l) => LABELS.find((x) => x.id === l)?.name).join(', ') : 'None'}</dd>
            <dt>Assignee</dt><dd>{assignee(current)}{who(current.assignee_id)?.name ?? 'Unassigned'}</dd>
          </dl>
        </aside>
      )}
      {pick && <Picker title={pick.kind === 'priority' ? 'Set priority' : pick.kind === 'assignee' ? 'Set assignee' : 'Set labels'} multi={pick.kind === 'label'} anchor={pick.rect} options={pickOptions()} onPick={applyPick} onClose={closePick} />}
      {palette && (
        <div className='overlay' onClick={closePalette}>
          <div className='palette' ref={dialogRef} role='dialog' aria-modal='true' aria-label='Command palette' onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== 'Tab') return;
              const f = dialogRef.current?.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]');
              if (!f || f.length === 0) return;
              const first = f[0] as HTMLElement; const last = f[f.length - 1] as HTMLElement;
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
              else if (f.length === 1) e.preventDefault();
            }}>
            <input
              autoFocus role='combobox' aria-expanded='true' aria-controls='palette-list' aria-activedescendant={results[pi] ? `pc-${results[pi].id}` : undefined} aria-autocomplete='list' aria-label='Search commands' placeholder='Type a command or search…' value={q}
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((p) => Math.min(p + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((p) => Math.max(p - 1, 0)); }
                else if (e.key === 'Enter') { const c = results[pi]; closePalette(); c?.run(); }
              }}
            />
            <ul id='palette-list' role='listbox' aria-label='Commands'>
              {results.map((c, idx) => (
                <li key={c.id} id={`pc-${c.id}`} role='option' aria-selected={idx === pi} onClick={() => { closePalette(); c.run(); }}><span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}</li>
              ))}
              {results.length === 0 && <li role='option' aria-selected='false' aria-disabled='true'>No matching command</li>}
            </ul>
            <div className='palette-foot'><kbd>↑↓</kbd> navigate <kbd>↵</kbd> run <kbd>esc</kbd> close</div>
          </div>
        </div>
      )}
    </div>
  );
}
