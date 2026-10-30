import { describe, expect, it } from 'vitest';
import { computeHealth } from '../../src/lib/project-health';

const base = { status: 'in_progress', start_date: '2026-10-01', target_date: '2026-10-31', created_at: '2026-09-01T10:00:00Z', issue_count: 10, progress_pct: 50 };
describe('computeHealth', () => {
  it('null when finished, no target, or no issues', () => {
    expect(computeHealth({ ...base, status: 'completed' }, '2026-10-20')).toBeNull();
    expect(computeHealth({ ...base, status: 'canceled' }, '2026-10-20')).toBeNull();
    expect(computeHealth({ ...base, target_date: null }, '2026-10-20')).toBeNull();
    expect(computeHealth({ ...base, issue_count: 0, progress_pct: 0 }, '2026-10-20')).toBeNull();
  });
  it('gap thresholds: <=10 on_track, <=25 at_risk, else off_track', () => {
    expect(computeHealth(base, '2026-10-16')).toBe('on_track'); // expected 50%
    expect(computeHealth({ ...base, progress_pct: 40 }, '2026-10-16')).toBe('on_track'); // gap 10
    expect(computeHealth({ ...base, progress_pct: 30 }, '2026-10-16')).toBe('at_risk'); // gap 20
    expect(computeHealth({ ...base, progress_pct: 10 }, '2026-10-16')).toBe('off_track'); // gap 40
  });
  it('past target: off_track unless 100%', () => {
    expect(computeHealth(base, '2026-11-02')).toBe('off_track');
    expect(computeHealth({ ...base, progress_pct: 100 }, '2026-11-02')).toBe('on_track');
  });
  it('before start: on_track; start defaults to the created day', () => {
    expect(computeHealth({ ...base, progress_pct: 0 }, '2026-09-20')).toBe('on_track');
    expect(computeHealth({ ...base, start_date: null, progress_pct: 0 }, '2026-09-01')).toBe('on_track');
  });
});
