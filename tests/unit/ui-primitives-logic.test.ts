import { describe, it, expect } from 'vitest';
import { moveIndex, firstEnabled, lastEnabled, typeahead } from '@/lib/ui/nav';
import { avatarSlot, initialsOf, AVATAR_SLOTS } from '@/lib/ui/avatar';
import { place } from '@/lib/ui/position';

const items = [{ label: 'Assign' }, { label: 'Archive', disabled: true }, { label: 'Copy link' }, { label: 'Delete' }];

describe('menu navigation', () => {
  it('skips disabled items and wraps', () => {
    expect(moveIndex(items, 0, 1)).toBe(2);
    expect(moveIndex(items, 3, 1)).toBe(0);
    expect(moveIndex(items, 0, -1)).toBe(3);
  });
  it('Home/End targets ignore disabled', () => {
    expect(firstEnabled([{ disabled: true }, { label: 'x' }])).toBe(1);
    expect(lastEnabled([{ label: 'x' }, { disabled: true }])).toBe(0);
  });
  it('returns -1 when everything is disabled', () => {
    expect(moveIndex([{ disabled: true }], 0, 1)).toBe(-1);
  });
  it('typeahead finds by prefix, skips disabled, cycles repeated letters', () => {
    expect(typeahead(items, 0, 'c')).toBe(2);
    expect(typeahead(items, 0, 'ar')).toBe(-1);
    expect(typeahead(items, 3, 'a')).toBe(0);
    expect(typeahead(items, 0, '')).toBe(-1);
  });
});

describe('avatar', () => {
  it('gives the 8 demo seed users 8 distinct avatar slots', () => {
    const seed = [2, 7, 8, 9, 81, 82, 83, 84].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    expect(new Set(seed.map(avatarSlot)).size).toBe(seed.length);
  });
  it('is stable and in range', () => {
    expect(avatarSlot('user-1')).toBe(avatarSlot('user-1'));
    for (const id of ['a', 'b', 'c', 'user-42', '']) expect(avatarSlot(id)).toBeLessThan(AVATAR_SLOTS);
  });
  it('spreads users over several slots', () => {
    const s = new Set(Array.from({ length: 40 }, (_, k) => avatarSlot(`u${k}`)));
    expect(s.size).toBeGreaterThan(4);
  });
  it('initials', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('linus')).toBe('LI');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('popover placement', () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 200, height: 300 };
  it('opens below when it fits', () => {
    expect(place({ top: 100, left: 100, width: 80, height: 24 }, size, view)).toEqual({ top: 128, left: 100, side: 'bottom' });
  });
  it('flips above when there is no room below', () => {
    const p = place({ top: 700, left: 100, width: 80, height: 24 }, size, view);
    expect(p.side).toBe('top');
    expect(p.top).toBe(700 - 4 - 300);
  });
  it('clamps horizontally and aligns end', () => {
    expect(place({ top: 0, left: 950, width: 40, height: 20 }, size, view).left).toBe(792);
    expect(place({ top: 0, left: 300, width: 100, height: 20 }, size, view, 'bottom', 'end').left).toBe(200);
  });
});
