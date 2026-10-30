'use client';
// Issue page header actions (Linear parity): prev/next with position, favorite, and the full "..." menu built on the Menu primitive.
import Link from 'next/link';
import { useEffect, useState, type RefObject } from 'react';
import { Menu, Tooltip, type MenuEntry } from '@/components/ui';

export interface HeaderNav { index: number; total: number; prev: string | null; next: string | null }
interface Props {
  ident: string; nav: HeaderNav | null; readOnly: boolean; entries: MenuEntry[]; moreRef: RefObject<HTMLButtonElement | null>; onRestore: () => void;
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

export function IssueHeaderBar({ ident, nav, readOnly, entries, moreRef, onRestore }: Props) {
  const [fav, toggleFav] = useFavorite(ident);
  const [menu, setMenu] = useState(false);
  const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';
  return (
    <div className='idh' role='toolbar' aria-label='Issue actions'>
      {nav && (
        <div className='idh-nav'>
          <span className='idh-pos' aria-label={`Issue ${nav.index + 1} of ${nav.total}`}>{nav.index + 1} <span className='idh-of'>/ {nav.total}</span></span>
          {nav.prev ? <Tooltip label='Previous issue'><Link className='idh-btn' href={nav.prev} aria-label='Previous issue'>{svg(UP)}</Link></Tooltip> : <span className='idh-btn' aria-disabled='true' aria-label='Previous issue' role='link'>{svg(UP)}</span>}
          {nav.next ? <Tooltip label='Next issue'><Link className='idh-btn' href={nav.next} aria-label='Next issue'>{svg(DOWN)}</Link></Tooltip> : <span className='idh-btn' aria-disabled='true' aria-label='Next issue' role='link'>{svg(DOWN)}</span>}
        </div>
      )}
      <Tooltip label={favLabel}><button className={`idh-btn idh-fav${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={favLabel} onClick={toggleFav}>{svg(STAR, fav)}</button></Tooltip>
      {readOnly && <button className='idh-text' onClick={onRestore}>Restore</button>}
      <Tooltip label='More actions'><button ref={moreRef} className='idh-btn' aria-label='More actions' aria-haspopup='menu' aria-expanded={menu} onClick={() => setMenu((m) => !m)}>{svg(DOTS)}</button></Tooltip>
      <Menu open={menu} anchorRef={moreRef} onClose={() => setMenu(false)} label={`${ident} actions`} entries={entries} align='end' />
    </div>
  );
}
