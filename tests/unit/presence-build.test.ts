import { describe, expect, it } from 'vitest';
import { buildPresence } from '@/lib/presence/build';
import { hueFor } from '@/lib/member-hue';

const now = Date.parse('2026-10-29T16:00:20Z');
const people = [{ id: 'a', name: 'Meg Abyte' }, { id: 'b', name: 'Linus Patch' }];

describe('buildPresence', () => {
  it('maps rows to users with hashed hue, initials, idle state, active first, minus me and dupes', () => {
    const rows = [
      { user_id: 'me', seen_at: '2026-10-29T16:00:19Z' },
      { user_id: 'b', seen_at: '2026-10-29T16:00:00Z' },
      { user_id: 'a', seen_at: '2026-10-29T16:00:15Z' },
      { user_id: 'a', seen_at: '2026-10-29T15:59:59Z' },
      { user_id: 'z', seen_at: '2026-10-29T16:00:18Z' },
    ];
    const out = buildPresence(rows, people, now, 'me');
    expect(out.map((u) => [u.id, u.active])).toEqual([['a', true], ['z', true], ['b', false]]);
    expect(out[0]).toMatchObject({ name: 'Meg Abyte', initials: 'MA', hue: hueFor('a') });
    expect(out[1]!.name).toBe('Unknown member');
  });
});
