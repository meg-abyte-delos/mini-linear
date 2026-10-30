'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { place, type Align, type Side } from '@/lib/ui/position';
import { useExitMount } from './useExitMount';

interface Props {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  side?: Side;
  align?: Align;
  role?: 'dialog' | 'menu' | 'listbox';
  initialFocus?: 'first' | 'container' | 'none';
  /** At least as wide as the anchor (value pickers), so the surface lines up with its trigger. */
  matchWidth?: boolean;
  children: ReactNode;
}

// Anchored, portalled surface: flips/clamps to the viewport, Esc and outside-press close, focus returns to the trigger.
export function Popover({ open, anchorRef, onClose, label, side = 'bottom', align = 'start', role = 'dialog', initialFocus = 'first', matchWidth = false, children }: Props) {
  const { mounted, state } = useExitMount(open);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const a = anchorRef.current, el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    if (matchWidth) el.style.setProperty('--pop-min-w', `${Math.round(r.width)}px`); else el.style.removeProperty('--pop-min-w');
    setPos(place({ top: r.top, left: r.left, width: r.width, height: r.height }, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, side, align));
  }, [open, mounted, anchorRef, side, align, matchWidth]);

  useEffect(() => {
    if (!open || !mounted) return;
    returnTo.current = (document.activeElement as HTMLElement | null) ?? anchorRef.current;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchorRef.current?.contains(t)) closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      (returnTo.current ?? anchorRef.current)?.focus?.();
    };
  }, [open, mounted, anchorRef]);

  // Focus only once the surface is placed: while it is still visibility:hidden the browser refuses to focus into it.
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !mounted || !placed) return;
    const el = ref.current;
    if (el && initialFocus === 'first') (el.querySelector<HTMLElement>('input,[role=menuitem]:not([aria-disabled=true]),button') ?? el).focus();
    else if (el && initialFocus === 'container') el.focus();
  }, [open, mounted, placed, initialFocus]);
  useEffect(() => { if (!mounted) setPos(null); }, [mounted]); // next open is placed afresh

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={ref} className='pop' role={role} aria-label={label} tabIndex={-1} data-state={state} data-side={pos?.side ?? side} style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}
