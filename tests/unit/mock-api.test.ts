import { describe, it, expect } from 'vitest';
import { createStore } from '@/lib/mock-api';

describe('mock api', () => {
  it('validates title and description bounds', () => {
    const s = createStore();
    expect(() => s.create({ title: '' })).toThrow();
    expect(() => s.create({ title: 'x'.repeat(256) })).toThrow();
    expect(() => s.create({ title: 'ok', description: 'd'.repeat(100_001) })).toThrow();
    expect(s.create({ title: 'x'.repeat(255), description: 'd'.repeat(100_000) }).id).toBe('DEL-1');
  });
  it('soft deletes and never reuses ids', () => {
    const s = createStore();
    const a = s.create({ title: 'a' });
    expect(s.remove(a.id)).toBe(true);
    expect(s.list()).toHaveLength(0);
    expect(s.remove(a.id)).toBe(false);
    expect(s.create({ title: 'b' }).id).toBe('DEL-2');
  });
  it('update bumps version, ignores deleted', () => {
    const s = createStore();
    const a = s.create({ title: 'a' });
    expect(s.update(a.id, { status: 'done' })?.version).toBe(2);
    s.remove(a.id);
    expect(s.update(a.id, { title: 'z' })).toBeNull();
  });
});
