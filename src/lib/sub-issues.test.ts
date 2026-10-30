import { describe, expect, it } from 'vitest';
import { subIssueStats } from './sub-issues';

const mk = (id: string, parent_id: string | null, status: string, deleted_at: string | null = null) => ({ id, parent_id, status, deleted_at });

describe('subIssueStats', () => {
  it('counts done over live children per parent, ignoring canceled and deleted', () => {
    const m = subIssueStats([mk('p', null, 'todo'), mk('a', 'p', 'done'), mk('b', 'p', 'todo'), mk('c', 'p', 'canceled'), mk('d', 'p', 'done', '2026-01-01'), mk('e', 'q', 'done')]);
    expect(m.get('p')).toEqual({ done: 1, total: 2, pct: 50 });
    expect(m.get('q')).toEqual({ done: 1, total: 1, pct: 100 });
    expect(m.has('a')).toBe(false);
  });
});
