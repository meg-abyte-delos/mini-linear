import { describe, expect, it } from 'vitest';
import { SHORTCUTS, createMatcher, keyOf } from '@/lib/shortcuts';
const ev = (key: string, o: object = {}) => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...o });
describe('shortcut registry', () => {
  it('has unique ids and no key collisions', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    expect(new Set(SHORTCUTS.map((s) => s.keys.join('+'))).size).toBe(SHORTCUTS.length);
  });
  it('normalises keys', () => {
    expect(keyOf(ev('J', { shiftKey: true }))).toBe('Shift+J');
    expect(keyOf(ev('k', { metaKey: true }))).toBe('Mod+K');
    expect(keyOf(ev('?', { shiftKey: true }))).toBe('?');
    expect(keyOf(ev('j', { altKey: true }))).toBeNull();
  });
  it('matches single keys and g-sequences', () => {
    const m = createMatcher();
    expect(m.feed('c')).toBe('create');
    expect(m.feed('g')).toBe('pending');
    expect(m.feed('p')).toBe('go-projects');
    expect(m.feed('p')).toBe('priority');
  });
  it('drops the prefix on timeout or a non-matching key', () => {
    let t = 0; const m = createMatcher(SHORTCUTS, () => t);
    m.feed('g'); t = 5000; expect(m.feed('i')).toBeNull();
    m.feed('g'); expect(m.feed('z')).toBeNull(); expect(m.feed('i')).toBeNull();
  });
});
