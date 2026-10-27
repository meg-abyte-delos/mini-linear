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
  it('update keeps unrelated fields', () => {
    const s = createStore();
    const a = s.create({ title: 'a', description: 'd', status: 'in_progress', priority: 2, assignee_id: 'u1' });
    const u = s.update(a.id, { title: 'b' })!;
    expect(u).toMatchObject({ title: 'b', description: 'd', status: 'in_progress', priority: 2, assignee_id: 'u1' });
  });
  it('ignores undefined keys in update', () => {
    const s = createStore();
    const a = s.create({ title: 'a', status: 'in_progress' });
    const u = s.update(a.id, { title: 'b', status: undefined });
    expect(u?.title).toBe('b');
    expect(u?.status).toBe('in_progress');
  });
});

describe('store.move', () => {
  it('changes status, bumps version, reorders and ignores unknown or deleted ids', () => {
    const s = createStore();
    const a = s.create({ title: 'a', status: 'todo' });
    const b = s.create({ title: 'b', status: 'done' });
    const m = s.move(b.id, 'todo', a.id)!;
    expect(m.status).toBe('todo');
    expect(m.version).toBe(2);
    expect(s.list().map((i) => i.id)).toEqual([b.id, a.id]);
    expect(s.move('DEL-99', 'done', null)).toBeNull();
    s.remove(a.id);
    expect(s.move(a.id, 'done', null)).toBeNull();
  });
});
