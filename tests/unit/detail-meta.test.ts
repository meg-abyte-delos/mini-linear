import { describe, it, expect } from 'vitest';
import { branchName, issueUrl, findByIdentifier, progress, dueState } from '@/lib/detail/issue-meta';
import { activeMention, insertMention, suggest, extractHandles } from '@/lib/detail/mentions';

describe('issue meta', () => {
  it('builds a Linear-style branch name', () => {
    expect(branchName('DEL-12', 'Fix: Créer la page détail!')).toBe('meg/del-12-fix-creer-la-page-detail');
    expect(branchName('DEL-1', '***')).toBe('meg/del-1');
    expect(branchName('DEL-1', 'x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
  it('builds an encoded issue url', () => expect(issueUrl('https://a.b/', 'delos', 'DEL-3')).toBe('https://a.b/w/delos/issue/DEL-3'));
  it('finds by identifier case-insensitively', () => {
    const xs = [{ id: 'u1', identifier: 'DEL-1', deleted_at: null }, { id: 'DEL-2', deleted_at: null }];
    expect(findByIdentifier(xs, 'del-1')?.id).toBe('u1');
    expect(findByIdentifier(xs, 'DEL-2')?.id).toBe('DEL-2');
    expect(findByIdentifier(xs, 'DEL-9')).toBeUndefined();
  });
  it('progress ignores canceled children', () => expect(progress([{ status: 'done' }, { status: 'todo' }, { status: 'canceled' }])).toEqual({ done: 1, total: 2 }));
  it('due state', () => {
    expect(dueState(null, '2026-10-28')).toBe('none');
    expect(dueState('2026-10-27', '2026-10-28')).toBe('overdue');
    expect(dueState('2026-10-30', '2026-10-28')).toBe('soon');
    expect(dueState('2026-12-01', '2026-10-28')).toBe('later');
    expect(dueState('bad', '2026-10-28')).toBe('none');
  });
});

describe('mentions', () => {
  const users = [{ id: 'u1', name: 'Meg Abyte', handle: 'meg' }, { id: 'u2', name: 'Linus Patch', handle: 'linus' }];
  it('detects the mention at the caret only after whitespace/start', () => {
    expect(activeMention('hi @me', 6)).toEqual({ start: 3, query: 'me' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('mail a@b', 8)).toBeNull();
    expect(activeMention('hi @me there', 12)).toBeNull();
  });
  it('suggests by handle or name word', () => {
    expect(suggest(users, 'pa').map((u) => u.id)).toEqual(['u2']);
    expect(suggest(users, '').length).toBe(2);
  });
  it('inserts the token and moves the caret', () => {
    const at = activeMention('ping @li now', 8)!;
    expect(insertMention('ping @li now', at, users[1]!)).toEqual({ text: 'ping @linus  now', caret: 12 });
  });
  it('extracts handles and uuids', () => expect(extractHandles('@Meg and @[Ada](0193a1b2-0000-7000-8000-000000000001) mail a@b.c').sort()).toEqual(['0193a1b2-0000-7000-8000-000000000001', 'meg']));
});
