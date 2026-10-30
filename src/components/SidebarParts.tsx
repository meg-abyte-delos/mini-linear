'use client';
// Sidebar chrome (Linear parity): workspace switcher + session avatar, collapsible team section.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import type { NlPeople } from '@/lib/nl-people';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

function Chevron({ open }: { open: boolean }) {
  return (<svg className={`sb-chev${open ? ' open' : ''}`} width='10' height='10' viewBox='0 0 10 10' aria-hidden='true' focusable='false'><path d='M3.5 2 6.5 5 3.5 8' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' /></svg>);
}

export function WorkspaceSwitcher({ slug, name = 'Delos', people }: { slug: string | null; name?: string; people: NlPeople }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = people.me ? people.users.find((u) => u.id === people.me) ?? null : null;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  const logout = async () => { try { await fetch('/api/v1/auth/logout', { method: 'POST' }); } finally { window.location.href = '/login'; } };
  return (
    <div className='ws' ref={ref}>
      <button className='ws-btn' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className='ws-logo' aria-hidden='true'>{name[0]}</span><span className='ws-name'>{name}</span>
        <svg className='ws-caret' width='10' height='10' viewBox='0 0 10 10' aria-hidden='true' focusable='false'><path d='M2.5 4 5 6.5 7.5 4' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' /></svg>
      </button>
      {me && <span className='av h1 ws-avatar' title={me.name} aria-label={`Signed in as ${me.name}`} role='img'>{initials(me.name)}</span>}
      {open && (
        <div className='ws-menu' role='menu' aria-label='Workspace'>
          {me && <div className='ws-menu-who'>{me.name}</div>}
          {slug && <a role='menuitem' href={`/w/${slug}/members`}>Members</a>}
          {slug && <a role='menuitem' href={`/w/${slug}/settings`}>Workspace settings</a>}
          <button role='menuitem' onClick={() => void logout()}>Log out</button>
        </div>
      )}
    </div>
  );
}

const KEY = 'ml.side.team.open';
export function TeamSection({ name, children, id = 'team-nav' }: { name: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === '0') setOpen(false); } catch { /* storage off */ } }, []);
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem(KEY, n ? '1' : '0'); } catch { /* storage off */ } return n; });
  return (
    <>
      <button className='side-link team-toggle' aria-expanded={open} aria-controls={id} onClick={toggle}><Icon name='team' /><span>{name}</span><Chevron open={open} /></button>
      <div id={id} className='team-nav' hidden={!open}>{children}</div>
    </>
  );
}

const SIDE_PATHS = {
  compose: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-4.3-4.3',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z',
  mine: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  views: 'M12 2 2 7l10 5 10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  issues: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  cycles: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M8 16H3v5',
  projects: 'M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8',
} as const;

/** Sidebar icon set: Lucide geometry, 14px, 1.75 stroke (matches #188). Local so it never conflicts with icons.tsx. */
export function SideIcon({ name }: { name: keyof typeof SIDE_PATHS }) {
  return (<svg className='ic side-ic' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={SIDE_PATHS[name]} /></svg>);
}
