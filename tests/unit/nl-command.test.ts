import { describe, expect, it } from 'vitest';
import { USERS, LABELS } from '@/lib/issues';
import { nlLabel, parseNlCommand } from '@/lib/nl-command';

const p = (s: string) => parseNlCommand(s, USERS, LABELS, 'u1');

describe('parseNlCommand', () => {
  it('parses assignee + priority', () => {
    const a = p('assign to Ada, high priority');
    expect(a?.patch).toEqual({ assignee_id: 'u3', priority: 2 });
    expect(nlLabel(a!)).toBe('Assign to Ada Byte · Priority High');
  });
  it('parses status, me and labels', () => {
    expect(p('move to in progress')?.patch).toEqual({ status: 'in_progress' });
    expect(p('mark as done')?.patch).toEqual({ status: 'done' });
    expect(p('assign to me')?.patch).toEqual({ assignee_id: 'u1' });
    expect(p('unassign')?.patch).toEqual({ assignee_id: null });
    expect(p('label bug, urgent priority')?.patch).toEqual({ priority: 1, add_label_ids: ['l1'] });
  });
  it('returns null for plain search text', () => {
    expect(p('board drag and drop')).toBeNull();
    expect(p('DEL-12')).toBeNull();
    expect(p('high')).toBeNull();
  });
  it('pluralises the label for a selection', () => {
    expect(nlLabel(p('assign Linus')!, 3)).toBe('Assign to Linus Patch (3 issues)');
  });
});
