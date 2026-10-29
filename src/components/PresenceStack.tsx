'use client';
import { Avatar } from '@/components/icons';

// Who is looking at this issue / board right now. Fed by usePresence (GET/POST /w/:slug/issues/:id/presence),
// or a static `presence` prop. Build PresenceUser with hueFor(id) so a member keeps one colour everywhere.
export interface PresenceUser { id: string; name: string; initials: string; hue: string; active?: boolean }
interface Props { presence: readonly PresenceUser[] | undefined; max?: number; size?: 'sm' | 'md'; label?: string }

const tip = (u: PresenceUser) => (u.active === false ? `${u.name} (idle)` : u.name);

export function PresenceStack({ presence, max = 3, size = 'sm', label = 'Viewing now' }: Props) {
  const list = (presence ?? []).filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i);
  if (list.length === 0) return null;
  // Linear never shows "+1": if only one would overflow, show it instead of the chip.
  const cap = list.length === max + 1 ? max + 1 : max;
  const shown = list.slice(0, cap);
  const hidden = list.slice(cap);
  const names = list.map(tip).join(', ');
  return (
    <div className='presence' data-size={size} role='group' aria-label={`${label}: ${names}`}>
      {shown.map((u, i) => (
        <span key={u.id} className='presence-av' data-active={u.active === false ? 'false' : 'true'} data-tip={tip(u)} style={{ zIndex: shown.length - i }}>
          <Avatar initials={u.initials} hue={u.hue} />
        </span>
      ))}
      {hidden.length > 0 && <span className='presence-more' aria-hidden='true' data-tip={hidden.map(tip).join(', ')}>+{hidden.length}</span>}
    </div>
  );
}
