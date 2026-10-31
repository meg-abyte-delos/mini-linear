'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui';

/** One confirmation toast (role=status) that clears itself after 4 s. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string | null) => {
    if (t.current) clearTimeout(t.current);
    setMsg(m);
    if (m) t.current = setTimeout(() => setMsg(null), 4000);
  }, []);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const toast = msg ? <p role='status' className='toast'>{msg}</p> : null;
  return { show, toast };
}

/** Destructive confirmation that only enables once the exact name is typed. */
export function NameConfirmDialog({ open, name, title, confirmLabel, busy, children, onConfirm, onCancel }: { open: boolean; name: string; title: string; confirmLabel: string; busy?: boolean; children: ReactNode; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  return (
    <ConfirmDialog open={open} destructive busy={busy} confirmDisabled={typed !== name} title={title} confirmLabel={confirmLabel} onConfirm={onConfirm} onCancel={onCancel}>
      {children}
      <label className='set-field set-confirm-field'><span className='set-label'>Type <strong>{name}</strong> to confirm</span>
        <input className='set-input' autoComplete='off' value={typed} onChange={(e) => setTyped(e.target.value)} aria-label={`Type ${name} to confirm`} /></label>
    </ConfirmDialog>
  );
}

export const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).every((k) => a[k] === b[k]);
