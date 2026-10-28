import { describe, expect, it } from 'vitest';
import { barFor, isOverdue, progress, roadmapRange, sortProjects, todayPct } from '@/lib/roadmap';

describe('roadmap', () => {
  const range = { from: '2026-01-01', to: '2026-01-11' };
  it('range pads a week and is null without dates', () => {
    expect(roadmapRange([{ start: null, end: null }])).toBeNull();
    expect(roadmapRange([{ start: '2026-01-08', end: '2026-01-22' }])).toEqual({ from: '2026-01-01', to: '2026-01-29' });
  });
  it('bar positions inside the window, one-date marker, none', () => {
    expect(barFor({ start: '2026-01-01', end: '2026-01-05' }, range)).toEqual({ leftPct: 0, widthPct: 50 });
    expect(barFor({ start: null, end: '2026-01-06' }, range)?.widthPct).toBe(10);
    expect(barFor({ start: null, end: null }, range)).toBeNull();
  });
  it('today marker only inside the window', () => {
    expect(todayPct('2026-01-06', range)).toBe(50);
    expect(todayPct('2025-12-01', range)).toBeNull();
  });
  it('overdue ignores finished projects', () => {
    expect(isOverdue('2026-01-01', 'in_progress', '2026-01-02')).toBe(true);
    expect(isOverdue('2026-01-01', 'completed', '2026-01-02')).toBe(false);
    expect(isOverdue(null, 'planned', '2026-01-02')).toBe(false);
  });
  it('progress excludes canceled issues, matches the API', () => {
    expect(progress([{ status: 'done' }, { status: 'todo' }, { status: 'canceled' }])).toEqual({ done: 1, total: 2, pct: 50 });
    expect(progress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('sorts by target date, undated last', () => {
    expect(sortProjects([{ name: 'b' }, { name: 'a', target_date: '2026-02-01' }]).map((p) => p.name)).toEqual(['a', 'b']);
  });
});
