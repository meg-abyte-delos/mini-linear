import { describe, expect, it } from 'vitest';
import { statusOf, splitStatusSummary } from '@/lib/detail/activity-status';

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

describe('splitStatusSummary', () => {
  it('cuts around both status names', () => {
    expect(splitStatusSummary('changed status from Backlog to Todo')).toEqual({ lead: 'changed status ', from: 'backlog', fromText: 'Backlog', to: 'todo', toText: 'Todo', tail: '' });
    expect(splitStatusSummary('set status to In Review')).toEqual({ lead: 'set status ', from: null, fromText: '', to: 'in_review', toText: 'In review', tail: '' });
  });
  it('keeps a following change in the tail and ignores unknown names', () => {
    expect(splitStatusSummary('changed status from Todo to In Progress, changed priority from No priority to High')).toEqual({ lead: 'changed status ', from: 'todo', fromText: 'Todo', to: 'in_progress', toText: 'In progress', tail: ', changed priority from No priority to High' });
    expect(splitStatusSummary('set status to Bogus')).toBeNull();
    expect(splitStatusSummary('set priority to High')).toBeNull();
  });
});
