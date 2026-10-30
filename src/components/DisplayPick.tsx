'use client';
import { useRef, useState } from 'react';
import { Menu } from '@/components/ui';

const Check = () => <svg width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round'><path d='M3.5 8.5l3 3 6-7' /></svg>;
const Chev = () => <svg width='10' height='10' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.75' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='M4 6l4 4 4-4' /></svg>;

// Linear-style value trigger for the Display popover: a quiet button that opens a role=menu (Wave A Menu primitive).
export function DisplayPick<K extends string>({ label, value, labels, onChange, autoFocus }: { label: string; value: K; labels: Record<K, string>; onChange: (v: K) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const keys = Object.keys(labels) as K[];
  return (
    <>
      <button ref={ref} type='button' className='dp-pick' aria-label={label} aria-haspopup='menu' aria-expanded={open} data-value={value} autoFocus={autoFocus} onClick={() => setOpen((o) => !o)}>
        <span>{labels[value]}</span><Chev />
      </button>
      <Menu open={open} anchorRef={ref} onClose={() => setOpen(false)} label={label} align='end'
        entries={keys.map((k) => ({ id: k, label: labels[k], icon: k === value ? <Check /> : undefined, onSelect: () => onChange(k) }))} />
    </>
  );
}
