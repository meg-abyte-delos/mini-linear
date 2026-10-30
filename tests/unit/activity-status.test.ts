import { describe, expect, it } from 'vitest';
import { statusOf } from '@/lib/detail/activity-status';

describe('statusOf', () => {
  it('reads the structured status change', () => {
    expect(statusOf({ action: 'update', summary: 'changed status from Todo to In Progress', changes: [{ field: 'status', after: 'in_progress' }] })).toBe('in_progress');
  });
  it('parses the local optimistic wording', () => {
    expect(statusOf({ action: 'set status to In Review', summary: 'set status to In Review' })).toBe('in_review');
    expect(statusOf({ action: 'x', summary: 'changed status from Backlog to Todo' })).toBe('todo');
  });
  it('is null for other entries and unknown statuses', () => {
    expect(statusOf({ action: 'created the issue' })).toBeNull();
    expect(statusOf({ action: 'u', summary: 'set priority to High', changes: [{ field: 'priority', after: 2 }] })).toBeNull();
    expect(statusOf({ action: 'u', changes: [{ field: 'status', after: 'bogus' }], summary: 'set status to Bogus' })).toBeNull();
  });
});
