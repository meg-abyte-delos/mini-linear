import { describe, expect, it } from 'vitest';
import { applyFilters, cycleBucket, emptyFilters, parseFilters, writeFilters } from '@/lib/filters';
import { MOCK_ISSUES } from '@/lib/issues';

describe('filters', () => {
  it('parses known values only and round-trips through the URL', () => {
    const f = parseFilters(new URLSearchParams('status=todo,bogus,done&assignee=none,u1&label=zz&seed=5'));
    expect(f.status).toEqual(['todo', 'done']);
    expect(f.assignee).toEqual(['none', 'u1']);
    expect(f.label).toEqual([]);
    expect(writeFilters('seed=5&cycle=c9', f)).toBe('seed=5&status=todo,done&assignee=none,u1');
  });
  it('writes nothing for empty filters and drops stale keys', () => {
    expect(writeFilters('status=todo&seed=3', emptyFilters())).toBe('seed=3');
  });
  it('ANDs dimensions, ORs values', () => {
    const one = applyFilters(MOCK_ISSUES, { ...emptyFilters(), status: ['todo', 'done'] });
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((i) => i.status === 'todo' || i.status === 'done')).toBe(true);
    const both = applyFilters(MOCK_ISSUES, { ...emptyFilters(), status: ['todo'], assignee: ['none'] });
    expect(both.every((i) => i.status === 'todo' && i.assignee_id === null)).toBe(true);
    expect(applyFilters(MOCK_ISSUES, emptyFilters())).toHaveLength(MOCK_ISSUES.length);
  });
  it('filters by label, project and cycle', () => {
    const c = applyFilters(MOCK_ISSUES, { ...emptyFilters(), cycle: ['c1'] });
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((i) => i.cycle_id === 'c1')).toBe(true);
    expect(applyFilters(MOCK_ISSUES, { ...emptyFilters(), cycle: ['none'] }).every((i) => i.cycle_id === null)).toBe(true);
    expect(applyFilters(MOCK_ISSUES, { ...emptyFilters(), project: ['p1'] }).every((i) => i.project_id === 'p1')).toBe(true);
    expect(applyFilters(MOCK_ISSUES, { ...emptyFilters(), label: ['l1'] }).every((i) => i.label_ids.includes('l1'))).toBe(true);
  });
  it('buckets cycles by date, inclusive bounds', () => {
    const c = { start_date: '2026-10-19', end_date: '2026-11-01' };
    expect(cycleBucket(c, '2026-10-18')).toBe('upcoming');
    expect(cycleBucket(c, '2026-10-19')).toBe('active');
    expect(cycleBucket(c, '2026-11-01')).toBe('active');
    expect(cycleBucket(c, '2026-11-02')).toBe('past');
  });
});

describe('parseFilters in API mode (#28)', () => {
  const uid = '0192f3a0-0000-7000-8000-000000000001';
  it('keeps ?assignee=<uuid> and none, drops junk', () => {
    const sp = new URLSearchParams(`assignee=${uid},none,bogus`);
    expect(parseFilters(sp, undefined, true).assignee).toEqual([uid, 'none']);
    expect(parseFilters(sp).assignee).toEqual(['none']);
  });
});
