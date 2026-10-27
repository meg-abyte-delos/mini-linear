'use client';
import { useEffect, useRef, useState } from 'react';
import { fuzzyFilter } from '@/lib/fuzzy';

export interface PickOption { id: string; label: string; checked?: boolean; lead?: React.ReactNode }
interface Props {
  title: string;
  options: PickOption[];
  multi?: boolean;
  anchor: DOMRect | null;
  onPick: (id: string) => void;
  onClose: () => void;
}

// Anchored popover: type-to-filter, Up/Down + Enter to apply, Esc closes. Focus stays in the filter input (a one-stop focus trap).
export function Picker({ title, options, multi, anchor, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const results = fuzzyFilter(options, q, (o) => o.label);
  const active = Math.min(i, Math.max(results.length - 1, 0));
  useEffect(() => { ref.current?.querySelector('input')?.focus(); }, []);
  const top = anchor ? Math.min(anchor.bottom + 4, window.innerHeight - 280) : 120;
  const left = anchor ? Math.min(Math.max(anchor.left + 40, 8), window.innerWidth - 248) : 120;
  return (
    <div className='picker-scrim' onMouseDown={onClose}>
      <div ref={ref} className='picker' role='dialog' aria-modal='true' aria-label={title} style={{ top, left }} onMouseDown={(e) => e.stopPropagation()}>
        <input
          role='combobox' aria-expanded='true' aria-controls='picker-list' aria-autocomplete='list' aria-label={`Filter: ${title}`}
          aria-activedescendant={results[active] ? `po-${results[active].id}` : undefined} placeholder={title} value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(active + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(active - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const o = results[active]; if (o) onPick(o.id); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Tab') e.preventDefault();
          }}
        />
        <ul id='picker-list' role='listbox' aria-label={title} aria-multiselectable={multi || undefined}>
          {results.map((o, idx) => (
            <li key={o.id} id={`po-${o.id}`} role='option' aria-selected={!!o.checked} data-active={idx === active} onClick={() => onPick(o.id)}>
              {o.lead}<span>{o.label}</span>{o.checked !== undefined && <span className='tick' aria-hidden='true'>{o.checked ? '✓' : ''}</span>}
            </li>
          ))}
          {results.length === 0 && <li role='option' aria-selected='false' aria-disabled='true'>No match</li>}
        </ul>
      </div>
    </div>
  );
}
