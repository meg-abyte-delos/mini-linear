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

describe('parseNlCommand: unresolved me', () => {
  it('blocks the whole action while people load (no partial priority)', () => {
    const a = parseNlCommand('assign to me, urgent', USERS, LABELS, null, { peopleLoading: true });
    expect(a?.blocked).toBe('Loading members…');
    expect(a?.patch).toEqual({});
    expect(nlLabel(a!)).toBe('Loading members…');
  });
  it("blocks with Can't resolve me when /me failed", () => {
    const a = parseNlCommand('assign to me, urgent', USERS, LABELS, null);
    expect(a?.blocked).toBe("Can't resolve me");
    expect(a?.patch).toEqual({});
  });
});

describe('parseNlCommand: ambiguous names', () => {
  const A1 = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada Byte' };
  const A2 = { id: '22222222-2222-4222-8222-222222222222', name: 'Ada Lovelace' };
  const users = [A1, A2];
  it('first-name tie gives no assignee and an Ambiguous row', () => {
    const a = parseNlCommand('assign to ada, high priority', users);
    expect(a?.blocked).toBe('Ambiguous: Ada Byte / Ada Lovelace');
    expect(a?.patch).toEqual({});
    expect(nlLabel(a!)).toBe('Ambiguous: Ada Byte / Ada Lovelace');
  });
  it('full name resolves the tie', () => {
    expect(parseNlCommand('assign to ada lovelace', users)?.patch).toEqual({ assignee_id: A2.id });
  });
  it('a unique first name still resolves', () => {
    expect(parseNlCommand('assign to ada', [A1])?.patch).toEqual({ assignee_id: A1.id });
  });
});
