'use client';

export type BulkKind = 'status' | 'priority' | 'assignee' | 'label' | 'project' | 'cycle';

// 16px stroke glyphs, same grid as icons.tsx (kept local so this item does not touch the shared icon set).
const GLYPH: Record<BulkKind, string> = {
  status: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 5v3l2 1.5',
  priority: 'M3 12.5V9.5M6.5 12.5V7M10 12.5V4.5M13.5 12.5V3',
  assignee: 'M8 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.5 13.5c.6-2.3 2.3-3.5 4.5-3.5s3.9 1.2 4.5 3.5',
  label: 'M2.5 3.5v4l6 6 5-5-6-6h-4a1 1 0 0 0-1 1ZM5.5 5.5h.1',
  project: 'M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z',
  cycle: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5',
};
const ACTIONS: { kind: BulkKind; label: string; key?: string }[] = [
  { kind: 'status', label: 'Status', key: 'S' }, { kind: 'priority', label: 'Priority', key: 'P' }, { kind: 'assignee', label: 'Assignee', key: 'A' },
  { kind: 'label', label: 'Labels', key: 'L' }, { kind: 'project', label: 'Project' }, { kind: 'cycle', label: 'Cycle' },
];

function Glyph({ d }: { d: string }) {
  return <svg className='selbar-ic' width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'><path d={d} /></svg>;
}

// Shown while 2+ issues are selected. Each button opens the matching picker, applied to the whole selection.
// openKind: the picker currently open from this bar (drives aria-expanded); optional so callers can omit it.
export function SelectionBar({ count, canUndo, openKind = null, onAction, onUndo, onClear, onDelete }: { count: number; canUndo: boolean; openKind?: BulkKind | null; onAction: (k: BulkKind, rect: DOMRect) => void; onUndo: () => void; onClear: () => void; onDelete?: () => void }) {
  return (
    <div className='selbar' role='toolbar' aria-label={`Bulk actions for ${count} selected issues`}>
      <span className='selbar-count' aria-live='polite'>{count} selected</span>
      <button className='selbar-x' aria-label='Clear selection' aria-keyshortcuts='Escape' title='Clear selection (Esc)' onClick={onClear}>
        <svg width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' aria-hidden='true' focusable='false'><path d='M4 4l8 8M12 4l-8 8' /></svg>
      </button>
      <span className='selbar-sep' aria-hidden='true' />
      {ACTIONS.map((a) => (
        <button key={a.kind} id={`sb-${a.kind}`} aria-haspopup='dialog' aria-expanded={openKind === a.kind}
          aria-keyshortcuts={a.key} title={a.key ? `${a.label} (${a.key})` : a.label}
          onClick={(e) => onAction(a.kind, e.currentTarget.getBoundingClientRect())}>
          <Glyph d={GLYPH[a.kind]} /><span>{a.label}</span>{a.key && <kbd aria-hidden='true'>{a.key}</kbd>}
        </button>
      ))}
      {onDelete && <><span className='selbar-sep' aria-hidden='true' /><button className='selbar-del' id='sb-delete' aria-haspopup='dialog' aria-keyshortcuts='Delete' title='Delete (#)' onClick={onDelete}><span>Delete</span><kbd aria-hidden='true'>#</kbd></button></>}
      {canUndo && <><span className='selbar-sep' aria-hidden='true' /><button className='selbar-undo' aria-keyshortcuts='Control+Z' onClick={onUndo}>Undo</button></>}
    </div>
  );
}
