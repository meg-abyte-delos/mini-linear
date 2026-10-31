'use client';
// Issue page chrome: app sidebar + off-canvas drawer below 900px, toggled from the issue header (same behaviour as Shell).
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { WIDE_MQ } from '@/lib/breakpoints';
import { AppSidebar } from '@/components/AppSidebar';

type NavCtx = { open: boolean; toggle: () => void; toggleRef: React.RefObject<HTMLButtonElement | null> };
const Ctx = createContext<NavCtx | null>(null);
export const useIssueNav = () => useContext(Ctx);

export function IssueShell({ slug, children }: { slug: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const side = document.getElementById('app-sidebar');
    if (open) {
      wasOpen.current = true;
      side?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus();
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const a = document.activeElement;
    if (!a || a === document.body || side?.contains(a)) toggleRef.current?.focus();
  }, [open]);
  useEffect(() => { const mq = window.matchMedia(WIDE_MQ); const f = () => { if (mq.matches) setOpen(false); }; f(); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen((o) => !o), toggleRef }}>
      <div className='shell issue-shell' data-nav={open ? 'open' : undefined}>
        <AppSidebar slug={slug} current='issue' id='app-sidebar' onNavigate={() => setOpen(false)} />
        <div className='side-scrim' aria-hidden='true' onClick={() => setOpen(false)} />
        <div className='main idp-host' inert={open || undefined}>{children}</div>
      </div>
    </Ctx.Provider>
  );
}

/** Header button that opens the app sidebar drawer (visible below 900px only, via .side-toggle CSS). */
export function IssueNavToggle() {
  const nav = useIssueNav();
  if (!nav) return null;
  return <button type='button' ref={nav.toggleRef} className='side-toggle' aria-label='Open sidebar' title='Open sidebar' aria-controls='app-sidebar' aria-expanded={nav.open} onClick={nav.toggle}><svg width='16' height='16' viewBox='0 0 16 16' aria-hidden='true' focusable='false'><rect x='1.75' y='2.75' width='12.5' height='10.5' rx='2' fill='none' stroke='currentColor' strokeWidth='1.5' /><path d='M6 3v10' stroke='currentColor' strokeWidth='1.5' /></svg></button>;
}
