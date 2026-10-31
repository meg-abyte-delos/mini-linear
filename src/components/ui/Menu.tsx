'use client';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { Popover } from './Popover';
import { Kbd } from './Kbd';
import { firstEnabled, lastEnabled, moveIndex, typeahead } from '@/lib/ui/nav';

export type MenuItem = { type?: 'item'; id: string; label: string; icon?: ReactNode; shortcut?: string[]; destructive?: boolean; disabled?: boolean; onSelect: () => void };
export type MenuEntry = { type: 'separator' } | MenuItem;

interface Props { open: boolean; anchorRef: RefObject<HTMLElement | null>; onClose: () => void; label: string; entries: MenuEntry[]; align?: 'start' | 'end'; matchWidth?: boolean }

// role=menu with roving focus: Up/Down/Home/End, typeahead, Enter/Space select, Esc closes and returns focus.
export function Menu({ open, anchorRef, onClose, label, entries, align, matchWidth }: Props) {
  const items = entries.filter((e): e is MenuItem => e.type !== 'separator');
  const [active, setActive] = useState(() => firstEnabled(items));
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (open) setActive(firstEnabled(items)); } // fresh start on every open
  const typed = useRef({ s: '', t: 0 });
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const focusAt = (k: number) => { if (k >= 0) { setActive(k); refs.current[k]?.focus(); } };
  const choose = (it: MenuItem) => { if (it.disabled) return; onClose(); it.onSelect(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(moveIndex(items, active, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(moveIndex(items, active, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(firstEnabled(items)); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(lastEnabled(items)); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
    else if ((e.key === 'Enter' || e.key === ' ') && items[active]) { e.preventDefault(); choose(items[active]); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current.s = now - typed.current.t > 700 ? e.key : typed.current.s + e.key;
      typed.current.t = now;
      focusAt(typeahead(items, active, typed.current.s));
    }
  };

  let idx = -1;
  return (
    <Popover open={open} anchorRef={anchorRef} onClose={onClose} label={label} role='menu' align={align} matchWidth={matchWidth} initialFocus='first'>
      <div className='menu' onKeyDown={onKeyDown}>
        {entries.map((e, n) => {
          if (e.type === 'separator') return <div key={`sep-${n}`} role='separator' className='menu-sep' />;
          idx += 1;
          const k = idx;
          return (
            <div
              key={e.id} ref={(el) => { refs.current[k] = el; }} role='menuitem' tabIndex={k === active ? 0 : -1}
              aria-disabled={e.disabled || undefined} data-tone={e.destructive ? 'danger' : undefined} data-active={k === active}
              className='menu-item' onClick={() => choose(e)} onMouseEnter={() => !e.disabled && setActive(k)}
            >
              <span className='menu-ic' aria-hidden='true'>{e.icon}</span>
              <span className='menu-label'>{e.label}</span>
              {e.shortcut && <Kbd keys={e.shortcut} />}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
