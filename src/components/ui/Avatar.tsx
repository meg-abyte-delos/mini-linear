import { avatarSlot, initialsOf } from '@/lib/ui/avatar';

type Size = 'sm' | 'md' | 'lg';
// One color per user (stable hash of the id). Decorative by default; pass `labelled` when it is the only name on screen.
export function UserAvatar({ userId, name, size = 'md', labelled }: { userId: string; name: string; size?: Size; labelled?: boolean }) {
  return (
    <span className={`uav uav-${size} uav-c${avatarSlot(userId)}`} role={labelled ? 'img' : undefined} aria-label={labelled ? name : undefined} aria-hidden={labelled ? undefined : true}>
      {initialsOf(name)}
    </span>
  );
}

// Unassigned: dashed outline with a person glyph.
export function UnassignedAvatar({ size = 'md', labelled }: { size?: Size; labelled?: boolean }) {
  return (
    <span className={`uav uav-${size} uav-none`} role={labelled ? 'img' : undefined} aria-label={labelled ? 'Unassigned' : undefined} aria-hidden={labelled ? undefined : true}>
      <svg viewBox='0 0 16 16' width='60%' height='60%' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' focusable='false'>
        <circle cx='8' cy='6' r='2.5' /><path d='M3 13.5c.6-2.4 2.5-3.5 5-3.5s4.4 1.1 5 3.5' />
      </svg>
    </span>
  );
}
