import { describe, it, expect } from 'vitest';
import { moveIssue } from '@/lib/move';
import type { Issue, Status } from '@/lib/issues';

const mk = (id: string, status: Status): Issue => ({ id, title: id, description: '', status, priority: 0, assignee_id: null, label_ids: [], created_at: '2026-01-01T00:00:00Z', version: 1 }) as unknown as Issue;
const ids = (a: readonly Issue[]) => a.map((i) => i.id);
const base = [mk('A', 'todo'), mk('B', 'todo'), mk('C', 'done'), mk('D', 'backlog')];

describe('moveIssue', () => {
  it('inserts before the target row with the given status', () => {
    const r = moveIssue(base, 'C', 'todo', 'B');
    expect(ids(r)).toEqual(['A', 'C', 'B', 'D']);
    expect(r.find((i) => i.id === 'C')).toMatchObject({ status: 'todo', version: 2 });
  });
  it('reorders within the same status without bumping version', () => {
    const r = moveIssue(base, 'B', 'todo', 'A');
    expect(ids(r)).toEqual(['B', 'A', 'C', 'D']);
    expect(r.find((i) => i.id === 'B')?.version).toBe(1);
  });
  it('appends after the last issue of the column', () => {
    const r = moveIssue(base, 'D', 'todo', null);
    expect(ids(r)).toEqual(['A', 'B', 'D', 'C']);
    expect(r.find((i) => i.id === 'D')?.status).toBe('todo');
  });
  it('moves into an empty column (appended at the end)', () => {
    const r = moveIssue(base, 'A', 'in_review', null);
    expect(ids(r)).toEqual(['B', 'C', 'D', 'A']);
    expect(r.find((i) => i.id === 'A')?.status).toBe('in_review');
  });
  it('is a no-op when dropped on itself or unknown id', () => {
    expect(moveIssue(base, 'A', 'todo', 'A')).toBe(base);
    expect(moveIssue(base, 'Z', 'todo', null)).toBe(base);
  });
  it('does not mutate its input', () => {
    const copy = JSON.stringify(base);
    moveIssue(base, 'C', 'todo', 'A');
    expect(JSON.stringify(base)).toBe(copy);
  });
});
