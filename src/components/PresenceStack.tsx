'use client';
import { Avatar } from '@/components/icons';

// Who is looking at this issue / board right now. For now fed by a `presence` prop;
// Linus's SSE feed (GET /w/:slug/issues/:id/presence) will plug into the same shape.
export interface PresenceUser { id: string; name: string; initials: string; hue: string; active?: boolean }
interface Props { presence: readonly PresenceUser[] | undefined; max?: number; size?: 'sm' | 'md'; label?: string }

export function PresenceStack({ presence, max = 3, size = 'sm', label = 'Viewing now' }: Props) {
  const list = (presence ?? []).filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const extra = list.length - shown.length;
  const names = list.map((u) => u.name).join(', ');
  return (
    <div className='presence' data-size={size} role='group' aria-label={`${label}: ${names}`} title={names}>
      {shown.map((u) => (
        <span key={u.id} className='presence-av' data-active={u.active === false ? 'false' : 'true'}>
          <Avatar initials={u.initials} hue={u.hue} />
        </span>
      ))}
      {extra > 0 && <span className='presence-more' aria-hidden='true'>+{extra}</span>}
    </div>
  );
}
