'use client';
// "Filter" toolbar menu (Linear parity): a "Filter…" search input on top, one row per category with its icon, arrow-key navigation.
import { useRef, useState } from 'react';
import { Icon, PriorityIcon, StatusIcon } from '@/components/icons';
import { FILTER_KEYS, type FilterKey, type Filters } from '@/lib/filters';

const LABEL: Record<FilterKey, string> = { status: 'Status', priority: 'Priority', assignee: 'Assignee', label: 'Label', project: 'Project', cycle: 'Cycle' };
const P = {
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  tag: 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4ZM7.5 7.5h.01',
  project: 'M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8',
} as const;
const Glyph = ({ d }: { d: string }) => (<svg className='ic' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={d} /></svg>);
function CategoryIcon({ k }: { k: FilterKey }) {
  if (k === 'status') return <StatusIcon status='in_progress' />;
  if (k === 'priority') return <PriorityIcon priority={2} />;
  if (k === 'cycle') return <Icon name='cycle' />;
  return <Glyph d={k === 'assignee' ? P.user : k === 'label' ? P.tag : P.project} />;
}

export function FilterMenu({ filters, onPick, onClose }: { filters: Filters; onPick: (k: FilterKey) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  const keys = FILTER_KEYS.filter((k) => !needle || LABEL[k].toLowerCase().includes(needle));
  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
  const move = (from: number, d: number) => {
    const els = items(); if (!els.length) return;
    if (from + d < 0) { input.current?.focus(); return; }
    els[Math.min(els.length - 1, from + d)]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) e.stopPropagation(); // typing belongs to the menu: global single-key shortcuts must not fire
    const els = items(); const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (at >= 0) move(at, -1); else els[els.length - 1]?.focus(); }
    else if (e.key === 'Home' && at >= 0) { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === 'End' && at >= 0) { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === 'Enter' && at < 0 && keys[0]) { e.preventDefault(); onPick(keys[0]); }
    else if (at >= 0 && e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) input.current?.focus(); // typing from a row goes to the input
  };
  return (
    <div className='tb-menu filter-menu' role='menu' aria-label='Filter by' onKeyDown={onKey}>
      <input ref={input} autoFocus className='fm-input' type='text' role='searchbox' aria-label='Filter…' placeholder='Filter…' value={q} onChange={(e) => setQ(e.target.value)} autoComplete='off' />
      <div ref={list} className='fm-list'>
        {keys.map((k) => (
          <button key={k} id={`fb-${filters[k].length ? 'm-' : ''}${k}`} type='button' role='menuitem' tabIndex={-1} onClick={() => onPick(k)}>
            <span className='fm-ic'><CategoryIcon k={k} /></span><span>{LABEL[k]}</span>
            {filters[k].length > 0 && <span className='fm-count'>{filters[k].length}</span>}
          </button>
        ))}
        {keys.length === 0 && <p className='fm-empty' role='presentation'>No filters match</p>}
      </div>
    </div>
  );
}
