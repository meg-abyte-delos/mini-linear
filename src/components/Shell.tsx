'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, type Issue, type Status } from '@/lib/issues';
import { fuzzyFilter } from '@/lib/fuzzy';

type View = 'list' | 'board';
interface Cmd { id: string; label: string; run: () => void }

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
      { id: `DEL-${n}`, title: `New issue ${n}`, description: '', status: 'todo', priority: 0, assignee_id: null, project_id: null, cycle_id: null, label_ids: [], parent_id: null, sort_key: String(n).padStart(4, '0'), version: 1 },
    ]);
  }
  function openPalette() { setPalette(true); setQ(''); setPi(0); }

  const commands: Cmd[] = [
    { id: 'create', label: 'Create issue', run: create },
    { id: 'list', label: 'Go to list view', run: () => setView('list') },
    { id: 'board', label: 'Go to board view', run: () => setView('board') },
    { id: 'status', label: 'Change status of selected issue', run: cycleStatus },
    { id: 'open', label: 'Open selected issue', run: () => setOpen(true) },
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

  const item = (i: Issue, cls: string) => (
    <div
      key={i.id} role='option' tabIndex={-1} aria-selected={current?.id === i.id} className={cls}
      onClick={() => { setSel(ordered.findIndex((x) => x.id === i.id)); setOpen(true); }}
    >
      <span className='id'>{i.id}</span><span>{i.title}</span>
      {cls === 'row' && <span>{PRIORITY_LABEL[i.priority]}</span>}
    </div>
  );

  return (
    <div className='shell'>
      <aside className='side'>
        <h1>Mini-Linear</h1>
        <nav aria-label='Primary'>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          <button aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</button>
          <button onClick={openPalette} aria-label='Open command palette'>Commands</button>
        </nav>
      </aside>
      <main className='main'>
        <div className='toolbar'>
          <button onClick={create}>New issue (C)</button>
        </div>
        {issues.length === 0 ? (
          <p className='empty'>No issues yet. Press C to create one.</p>
        ) : view === 'list' ? (
          <div role='listbox' aria-label='Issue list'>
            {STATUSES.map((s) => {
              const items = issues.filter((i) => i.status === s);
              if (!items.length) return null;
              return (
                <section key={s} className='group' aria-label={STATUS_LABEL[s]}>
                  <h2>{STATUS_LABEL[s]} ({items.length})</h2>
                  {items.map((i) => item(i, 'row'))}
                </section>
              );
            })}
          </div>
        ) : (
          <div className='board' role='listbox' aria-label='Issue board'>
            {STATUSES.map((s) => (
              <section key={s} className='col' aria-label={STATUS_LABEL[s]}>
                <h2>{STATUS_LABEL[s]}</h2>
                {issues.filter((i) => i.status === s).map((i) => item(i, 'card'))}
              </section>
            ))}
          </div>
        )}
      </main>
      {open && current && (
        <aside className='panel' aria-label='Issue detail'>
          <h2>{current.id}: {current.title}</h2>
          <p>Status: {STATUS_LABEL[current.status]}</p>
          <p>Priority: {PRIORITY_LABEL[current.priority]}</p>
          <button onClick={() => setOpen(false)}>Close (Esc)</button>
        </aside>
      )}
      {palette && (
        <div className='overlay' onClick={() => setPalette(false)}>
          <div className='palette' role='dialog' aria-modal='true' aria-label='Command palette' onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus aria-label='Search commands' value={q}
              onChange={(e) => { setQ(e.target.value); setPi(0); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setPi((p) => Math.min(p + 1, results.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setPi((p) => Math.max(p - 1, 0)); }
                else if (e.key === 'Enter') { results[pi]?.run(); setPalette(false); }
              }}
            />
            <ul role='listbox' aria-label='Commands'>
              {results.map((c, idx) => (
                <li key={c.id} role='option' aria-selected={idx === pi} onClick={() => { c.run(); setPalette(false); }}>{c.label}</li>
              ))}
              {results.length === 0 && <li role='option' aria-selected='false'>No matching command</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
