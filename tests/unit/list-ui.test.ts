import { describe, expect, it } from 'vitest';
import { hueOfId, initialsOf, listGroups, orderIssues, relDate, visibleOrder } from '@/lib/list-ui';

const now = new Date('2026-10-29T15:00:00Z');
describe('list-ui', () => {
  it('relDate is one short format', () => {
    expect(relDate('2026-10-29T01:00:00Z', now)).toBe('Oct 29');
    expect(relDate('2026-10-28T23:00:00Z', now)).toBe('Oct 28');
    expect(relDate('2026-10-25T10:00:00Z', now)).toBe('Oct 25');
    expect(relDate('2026-09-02T10:00:00Z', now)).toBe('Sep 2');
    expect(relDate('2025-12-31T10:00:00Z', now)).toBe('Dec 31, 2025');
    expect(relDate('nope', now)).toBe('');
  });
  it('hueOfId is stable and in range', () => {
    const id = '0190a3c4-0000-7000-8000-000000000001';
    expect(hueOfId(id)).toBe(hueOfId(id));
    expect(['h1', 'h2', 'h3', 'h4', 'h5']).toContain(hueOfId(id));
  });
  it('initialsOf', () => { expect(initialsOf('Ada Byte')).toBe('AB'); expect(initialsOf('rex')).toBe('R'); expect(initialsOf(' ')).toBe('?'); });
  it('orderIssues', () => {
    const xs = [{ priority: 0, created_at: '2026-01-01' }, { priority: 3, created_at: '2026-03-01' }, { priority: 1, created_at: '2026-02-01' }];
    expect(orderIssues(xs, 'priority').map((x) => x.priority)).toEqual([1, 3, 0]);
    expect(orderIssues(xs, 'created').map((x) => x.created_at)).toEqual(['2026-03-01', '2026-02-01', '2026-01-01']);
    expect(orderIssues(xs, 'manual')).toEqual(xs);
  });
});

describe('listGroups / visibleOrder (j/k order = render order)', () => {
  const mk = (id: string, status: string, priority: number, created_at: string) => ({ id, status, priority, created_at });
  const items = [mk('a', 'todo', 3, '2026-01-01'), mk('b', 'done', 1, '2026-01-03'), mk('c', 'todo', 1, '2026-01-02')];
  const S = ['todo', 'done', 'canceled'];
  it('groups by status, drops empty groups, applies ordering', () => {
    const g = listGroups(items, S, 'status', 'priority');
    expect(g.map((x) => x.key)).toEqual(['todo', 'done']);
    expect(g[0]!.items.map((x) => x.id)).toEqual(['c', 'a']);
  });
  it('grouping none orders across statuses', () => {
    expect(listGroups(items, S, 'none', 'created')[0]!.items.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });
  it('skips collapsed groups', () => {
    const g = listGroups(items, S, 'status', 'manual');
    expect(visibleOrder(g, new Set(['todo'])).map((x) => x.id)).toEqual(['b']);
  });
});
