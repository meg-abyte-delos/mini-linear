'use client';

export type BulkKind = 'status' | 'priority' | 'assignee' | 'label' | 'project' | 'cycle';
const ACTIONS: { kind: BulkKind; label: string }[] = [
  { kind: 'status', label: 'Status' }, { kind: 'priority', label: 'Priority' }, { kind: 'assignee', label: 'Assignee' },
  { kind: 'label', label: 'Labels' }, { kind: 'project', label: 'Project' }, { kind: 'cycle', label: 'Cycle' },
];

// Shown while 2+ issues are selected. Each button opens the matching picker, applied to the whole selection.
export function SelectionBar({ count, canUndo, onAction, onUndo, onClear }: { count: number; canUndo: boolean; onAction: (k: BulkKind, rect: DOMRect) => void; onUndo: () => void; onClear: () => void }) {
  return (
    <div className='selbar' role='toolbar' aria-label={`Bulk actions for ${count} selected issues`}>
      <span className='selbar-count'>{count} selected</span>
      {ACTIONS.map((a) => <button key={a.kind} id={`sb-${a.kind}`} aria-haspopup='dialog' onClick={(e) => onAction(a.kind, e.currentTarget.getBoundingClientRect())}>{a.label}</button>)}
      {canUndo && <button className='selbar-undo' onClick={onUndo}>Undo</button>}
      <button className='selbar-clear' aria-label='Clear selection' onClick={onClear}>Clear</button>
    </div>
  );
}
