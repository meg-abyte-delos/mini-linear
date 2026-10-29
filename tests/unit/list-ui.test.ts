import { describe, expect, it } from 'vitest';
import { hueOfId, initialsOf, orderIssues, relDate } from '@/lib/list-ui';

const now = new Date('2026-10-29T15:00:00Z');
describe('list-ui', () => {
  it('relDate is contextual', () => {
    expect(relDate('2026-10-29T01:00:00Z', now)).toBe('Today');
    expect(relDate('2026-10-28T23:00:00Z', now)).toBe('Yesterday');
    expect(relDate('2026-10-25T10:00:00Z', now)).toBe('4d ago');
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
