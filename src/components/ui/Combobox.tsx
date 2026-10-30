'use client';
import { useId, useState, type ReactNode, type RefObject } from 'react';
import { Popover } from './Popover';
import { fuzzyFilter } from '@/lib/fuzzy';
import { moveIndex, firstEnabled, lastEnabled } from '@/lib/ui/nav';

export interface ComboOption { id: string; label: string; lead?: ReactNode; hint?: ReactNode; checked?: boolean; disabled?: boolean }
interface Props { open: boolean; anchorRef: RefObject<HTMLElement | null>; onClose: () => void; label: string; options: ComboOption[]; onPick: (id: string) => void; multi?: boolean; placeholder?: string; emptyText?: string }

// ARIA 1.2 combobox picker: the input keeps DOM focus, aria-activedescendant tracks the highlighted option.
// Single-select closes on pick; multi stays open. Esc closes (Popover); Tab is swallowed like Picker.
export function Combobox({ open, anchorRef, onClose, label, options, onPick, multi, placeholder, emptyText = 'No match' }: Props) {
  const uid = useId();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const results = fuzzyFilter(options, q, (o) => o.label);
  const active = Math.min(i, Math.max(results.length - 1, 0));
  const optId = (id: string) => uid + '-o-' + id;
  const pick = (o: ComboOption) => { if (o.disabled) return; onPick(o.id); if (!multi) onClose(); };
  return (
    <Popover open={open} anchorRef={anchorRef} onClose={onClose} label={label} role='dialog' initialFocus='first'>
      <div className='combo'>
        <input
          className='combo-input' role='combobox' aria-expanded='true' aria-controls={uid + '-list'} aria-autocomplete='list' aria-label={'Filter: ' + label}
          aria-activedescendant={results[active] ? optId(results[active].id) : undefined} placeholder={placeholder ?? label} value={q}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.max(moveIndex(results, active, 1), 0)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(moveIndex(results, active, -1), 0)); }
            else if (e.key === 'Home') { e.preventDefault(); setI(Math.max(firstEnabled(results), 0)); }
            else if (e.key === 'End') { e.preventDefault(); setI(Math.max(lastEnabled(results), 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); const o = results[active]; if (o) pick(o); }
            else if (e.key === 'Tab') e.preventDefault();
          }}
        />
        <ul id={uid + '-list'} role='listbox' aria-label={label} aria-multiselectable={multi || undefined} className='combo-list'>
          {results.map((o, k) => (
            <li key={o.id} id={optId(o.id)} role='option' aria-selected={!!o.checked} aria-disabled={o.disabled || undefined} data-active={k === active} className='combo-opt' onMouseEnter={() => setI(k)} onClick={() => pick(o)}>
              {o.lead}<span className='combo-label'>{o.label}</span>{o.hint}{o.checked !== undefined && <span className='tick' aria-hidden='true'>{o.checked ? String.fromCharCode(10003) : ''}</span>}
            </li>
          ))}
          {results.length === 0 && <li role='option' aria-selected='false' aria-disabled='true' className='combo-empty'>{emptyText}</li>}
        </ul>
      </div>
    </Popover>
  );
}
