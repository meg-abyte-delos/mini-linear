'use client';
import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Kbd } from './Kbd';
import { useExitMount } from './useExitMount';
import { TOOLTIP_DELAY_MS } from './motion';

interface Props { label: string; shortcut?: string[]; delay?: number; children: ReactElement<Record<string, unknown>> }
type Handler = (e: unknown) => void;

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

// Shows on hover (after `delay`) and on keyboard focus, hides on blur/leave/Esc. Linked with aria-describedby; never takes focus.
export function Tooltip({ label, shortcut, delay = TOOLTIP_DELAY_MS, children }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const host = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const { mounted, state } = useExitMount(open);

  // A long label wraps (max-width in CSS) and is nudged back inside the viewport once its real width is known.
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el || !pos) return;
    el.style.left = `${pos.left}px`;
    const r = el.getBoundingClientRect(), m = 8;
    const dx = r.right > window.innerWidth - m ? window.innerWidth - m - r.right : r.left < m ? m - r.left : 0;
    if (dx) el.style.left = `${pos.left + dx}px`;
  }, [pos, mounted, label]);

  const show = (immediate: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = host.current;
      if (el) { const r = el.getBoundingClientRect(); setPos({ top: r.bottom + 6, left: Math.min(Math.max(r.left + r.width / 2, 60), window.innerWidth - 60) }); }
      setOpen(true);
    }, immediate ? 0 : delay);
  };
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  const childRef = (children.props as { ref?: Ref<HTMLElement> }).ref; // React 19: ref is a prop
  const orig = children.props as { onMouseEnter?: Handler; onMouseLeave?: Handler; onFocus?: Handler; onBlur?: Handler; onKeyDown?: (e: React.KeyboardEvent) => void };

  const trigger = cloneElement(children, {
    ref: (el: HTMLElement | null) => { host.current = el; setRef(childRef, el); }, // keep the child's own ref (e.g. a Popover anchor)
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: unknown) => { orig.onMouseEnter?.(e); show(false); },
    onMouseLeave: (e: unknown) => { orig.onMouseLeave?.(e); hide(); },
    onFocus: (e: unknown) => { orig.onFocus?.(e); show(true); },
    onBlur: (e: unknown) => { orig.onBlur?.(e); hide(); },
    onKeyDown: (e: React.KeyboardEvent) => { orig.onKeyDown?.(e); if (e.key === 'Escape') hide(); },
  });

  return (
    <>
      {trigger}
      {mounted && pos && typeof document !== 'undefined' && createPortal(
        <div ref={tip} id={id} role='tooltip' className='tip' data-state={state} style={{ top: pos.top, left: pos.left }}>
          <span className='tip-label'>{label}</span>{shortcut && <Kbd keys={shortcut} />}
        </div>,
        document.body,
      )}
    </>
  );
}
