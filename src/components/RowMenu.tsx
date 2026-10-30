'use client';
import { useRef, useState } from 'react';
import { Menu, type MenuEntry } from '@/components/ui';

// Row actions behind a three-dots button, shared by the Members and Teams tables.
export function RowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type='button' className='set-icon-btn' aria-label={label} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox='0 0 16 16' width='16' height='16' fill='currentColor' aria-hidden='true' focusable='false'><circle cx='3' cy='8' r='1.3' /><circle cx='8' cy='8' r='1.3' /><circle cx='13' cy='8' r='1.3' /></svg>
      </button>
      <Menu open={open} anchorRef={ref} onClose={() => setOpen(false)} label={label} entries={entries} align='end' />
    </>
  );
}
