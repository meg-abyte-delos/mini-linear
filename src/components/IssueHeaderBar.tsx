'use client';
// Issue page header (Linear parity): prev/next with position, favorite, "..." menu holding the lifecycle actions.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export interface HeaderNav { index: number; total: number; prev: string | null; next: string | null }
interface Props {
  ident: string; nav: HeaderNav | null; archived: boolean; readOnly: boolean;
  onCopyLink: () => void; onCopyBranch: () => void; onArchive: () => void; onUnarchive: () => void; onDelete: () => void; onRestore: () => void;
}

const svg = (d: string, filled = false) => (<svg width='16' height='16' viewBox='0 0 16 16' fill={filled ? 'currentColor' : 'none'} stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={d} /></svg>);
const UP = 'M4 10l4-4 4 4', DOWN = 'M4 6l4 4 4-4';
const STAR = 'M8 2.2l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.2l-3.52 1.85.68-3.93L2.3 6.35l3.95-.55Z';
const DOTS = 'M3.5 8h.01M8 8h.01M12.5 8h.01';

function useFavorite(ident: string) {
  const key = `ml.fav.${ident}`;
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem(key) === '1'); } catch { /* storage off */ } }, [key]);
  const toggle = () => setOn((v) => { const n = !v; try { if (n) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* storage off */ } return n; });
  return [on, toggle] as const;
}

export function IssueHeaderBar({ ident, nav, archived, readOnly, onCopyLink, onCopyBranch, onArchive, onUnarchive, onDelete, onRestore }: Props) {
  const [fav, toggleFav] = useFavorite(ident);
  const [menu, setMenu] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    wrap.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setMenu(false); btn.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [menu]);
  const run = (fn: () => void) => () => { setMenu(false); fn(); };
  return (
    <div className='idh' role='toolbar' aria-label='Issue actions'>
      {nav && (
        <div className='idh-nav'>
          <span className='idh-pos' aria-label={`Issue ${nav.index + 1} of ${nav.total}`}>{nav.index + 1} <span className='idh-of'>/ {nav.total}</span></span>
          {nav.prev ? <Link className='idh-btn' href={nav.prev} aria-label='Previous issue' title='Previous issue'>{svg(UP)}</Link> : <span className='idh-btn' aria-disabled='true' aria-label='Previous issue' role='link'>{svg(UP)}</span>}
          {nav.next ? <Link className='idh-btn' href={nav.next} aria-label='Next issue' title='Next issue'>{svg(DOWN)}</Link> : <span className='idh-btn' aria-disabled='true' aria-label='Next issue' role='link'>{svg(DOWN)}</span>}
        </div>
      )}
      <button className={`idh-btn idh-fav${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} title={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={toggleFav}>{svg(STAR, fav)}</button>
      {readOnly && <button className='idh-text' onClick={onRestore}>Restore</button>}
      <div className='idh-more' ref={wrap}>
        <button ref={btn} className='idh-btn' aria-label='More actions' title='More actions' aria-haspopup='menu' aria-expanded={menu} onClick={() => setMenu((m) => !m)}>{svg(DOTS)}</button>
        {menu && (
          <div className='idh-menu' role='menu' aria-label={`${ident} actions`}>
            <button role='menuitem' onClick={run(onCopyLink)}><span>Copy link</span><kbd>⌘.</kbd></button>
            <button role='menuitem' onClick={run(onCopyBranch)}><span>Copy branch</span><kbd>⌘⇧.</kbd></button>
            {!readOnly && <button role='menuitem' onClick={run(archived ? onUnarchive : onArchive)}><span>{archived ? 'Unarchive' : 'Archive'}</span></button>}
            {!readOnly && <><div className='idh-sep' role='separator' /><button role='menuitem' className='danger' onClick={run(onDelete)}><span>Delete</span></button></>}
          </div>
        )}
      </div>
    </div>
  );
}
