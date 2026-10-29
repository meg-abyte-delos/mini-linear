import { describe, it, expect } from 'vitest';
import { toPresenceUsers } from '@/lib/presence';

const people = [{ id: 'a', name: 'Ada Byte' }, { id: 'b', name: 'Presence B' }];
describe('toPresenceUsers', () => {
  it('maps ids to names and initials, hides me', () => {
    const u = toPresenceUsers(['a', 'b'], people, 'a');
    expect(u.map((x) => [x.id, x.name, x.initials])).toEqual([['b', 'Presence B', 'PB']]);
  });
  it('unknown ids show as Someone with a stable hue', () => {
    const [x] = toPresenceUsers(['zz'], people);
    expect(x!.name).toBe('Someone');
    expect(toPresenceUsers(['zz'], people)[0]!.hue).toBe(x!.hue);
  });
});
