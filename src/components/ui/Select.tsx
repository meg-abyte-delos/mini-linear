'use client';
import { useRef, useState } from 'react';
import { Menu, type MenuEntry } from './Menu';
import { Combobox, type ComboOption } from './Combobox';

export interface SelectOption { id: string; label: string }
interface Props {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Type-to-filter picker (long lists) instead of a plain menu. */
  searchable?: boolean;
  className?: string;
}

// Value picker built on the ui primitives (Menu / Combobox) in place of a native <select>:
// a button announcing "<label>, <current value>" that opens a themed, keyboard-driven popover.
export function Select({ label, value, options, onChange, placeholder = 'Choose…', disabled, searchable, className }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);
  const check = (on: boolean) => <span aria-hidden='true'>{on ? String.fromCharCode(10003) : ''}</span>;
  const entries: MenuEntry[] = options.map((o) => ({ id: o.id, label: o.label, icon: check(o.id === value), onSelect: () => onChange(o.id) }));
  const combo: ComboOption[] = options.map((o) => ({ id: o.id, label: o.label, checked: o.id === value }));
  return (
    <>
      <button
        ref={ref} type='button' className={`select-btn${className ? ' ' + className : ''}`} disabled={disabled}
        aria-label={`${label}: ${current?.label ?? placeholder}`} aria-haspopup={searchable ? 'dialog' : 'menu'} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='select-val' data-empty={!current || undefined}>{current?.label ?? placeholder}</span>
        <svg viewBox='0 0 16 16' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d='m4 6 4 4 4-4' /></svg>
      </button>
      {searchable
        ? <Combobox open={open} anchorRef={ref} onClose={() => setOpen(false)} label={label} options={combo} onPick={onChange} />
        : <Menu open={open} anchorRef={ref} onClose={() => setOpen(false)} label={label} entries={entries} matchWidth />}
    </>
  );
}
