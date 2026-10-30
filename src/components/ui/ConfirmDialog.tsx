'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useExitMount } from './useExitMount';

interface Props { open: boolean; title: string; children?: ReactNode; confirmLabel: string; cancelLabel?: string; destructive?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }

// Modal alertdialog: focus starts on Cancel (the safe action), Tab cycles inside, Esc and the scrim cancel, focus returns to the opener.
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel = 'Cancel', destructive, busy, onConfirm, onCancel }: Props) {
  const { mounted, state } = useExitMount(open);
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancelFn = useRef(onCancel);
  cancelFn.current = onCancel;
  const titleId = useId(), descId = useId();

  useEffect(() => {
    if (!open || !mounted) return;
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    // aria-modal alone does not keep Tab or screen readers out of the page: everything else is inert while the dialog is open.
    const scrim = ref.current?.parentElement;
    const others = Array.from(document.body.children).filter((n): n is HTMLElement => n instanceof HTMLElement && n !== scrim && !n.hasAttribute('inert'));
    others.forEach((n) => n.setAttribute('inert', ''));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancelFn.current(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []);
      if (!f.length) return;
      const first = f[0] as HTMLElement, lastEl = f[f.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); others.forEach((n) => n.removeAttribute('inert')); opener?.focus?.(); };
  }, [open, mounted]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className='dlg-scrim' data-state={state} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={ref} className='dlg' role='alertdialog' aria-modal='true' aria-labelledby={titleId} aria-describedby={children ? descId : undefined} data-state={state}>
        <h2 id={titleId} className='dlg-title'>{title}</h2>
        {children && <div id={descId} className='dlg-body'>{children}</div>}
        <div className='dlg-actions'>
          <button ref={cancelRef} type='button' className='dlg-btn' onClick={onCancel}>{cancelLabel}</button>
          <button type='button' className='dlg-btn dlg-confirm' data-destructive={destructive || undefined} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
