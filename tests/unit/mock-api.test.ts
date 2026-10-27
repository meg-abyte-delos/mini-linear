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

describe('priority / assignee / labels updates', () => {
  it('each field update goes through update and bumps the version', () => {
    const s = createStore();
    const a = s.create({ title: 'a' });
    expect(a.priority).toBe(0); expect(a.assignee_id).toBeNull(); expect(a.label_ids).toEqual([]);
    const p = s.update(a.id, { priority: 2 })!;
    expect(p.priority).toBe(2); expect(p.version).toBe(a.version + 1);
    const u = s.update(a.id, { assignee_id: 'u2' })!;
    expect(u.assignee_id).toBe('u2'); expect(u.priority).toBe(2); expect(u.version).toBe(a.version + 2);
    expect(s.update(a.id, { assignee_id: null })!.assignee_id).toBeNull();
    const l = s.update(a.id, { label_ids: ['l1', 'l3'] })!;
    expect(l.label_ids).toEqual(['l1', 'l3']); expect(l.version).toBe(a.version + 4);
  });
  it('rejects invalid priority and non-array labels', () => {
    const s = createStore();
    const a = s.create({ title: 'a' });
    expect(() => s.update(a.id, { priority: 7 as never })).toThrow();
    expect(() => s.update(a.id, { label_ids: 'l1' as never })).toThrow();
  });
});
