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
export function TeamSection({ name, children }: { name: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(KEY) === '0') setOpen(false); } catch { /* storage off */ } }, []);
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem(KEY, n ? '1' : '0'); } catch { /* storage off */ } return n; });
  return (
    <>
      <button className='side-link team-toggle' aria-expanded={open} aria-controls='team-nav' onClick={toggle}><Icon name='team' /><span>{name}</span><Chevron open={open} /></button>
      <div id='team-nav' className='team-nav' hidden={!open}>{children}</div>
    </>
  );
}
