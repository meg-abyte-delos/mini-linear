import { describe, expect, it } from 'vitest';
import { cycleScope, cycleTiming } from '../../src/lib/cycles-ui';

describe('cycles-ui', () => {
  const iss = [
    { cycle_id: 'c', status: 'done' }, { cycle_id: 'c', status: 'canceled' }, { cycle_id: 'c', status: 'in_progress' },
    { cycle_id: 'c', status: 'todo' }, { cycle_id: 'x', status: 'done' }, { cycle_id: null, status: 'done' },
  ] as const;
  it('scope excludes canceled, in progress / review as started', () => {
    expect(cycleScope(iss as never, 'c')).toEqual({ total: 3, started: 1, done: 1, pct: 33 });
  });
  it('empty cycle: 0%, no NaN', () => { expect(cycleScope([], 'c')).toEqual({ total: 0, started: 0, done: 0, pct: 0 }); });
  it('timing: days left (end inclusive), starts in, none for past', () => {
    const c = { start_date: '2026-10-28', end_date: '2026-11-10' };
    expect(cycleTiming(c, '2026-10-29', 'active')).toBe('13 days left');
    expect(cycleTiming(c, '2026-11-10', 'active')).toBe('Last day');
    expect(cycleTiming(c, '2026-10-24', 'upcoming')).toBe('Starts in 4 days');
    expect(cycleTiming(c, '2026-10-27', 'upcoming')).toBe('Starts tomorrow');
    expect(cycleTiming(c, '2026-11-20', 'past')).toBeNull();
  });
});
