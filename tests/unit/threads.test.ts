import { describe, expect, it } from 'vitest';
import { participants, repliesLabel, repliesOf, threadOpen } from '@/lib/detail/threads';
import type { Comment } from '@/lib/detail/api';

const c = (id: string, author: string | null, at: string, parent: string | null = null, extra: Partial<Comment> = {}): Comment => ({ id, body: id, author_id: author, parent_comment_id: parent, created_at: at, ...extra });

describe('comment threads', () => {
  const root = c('r', 'a', '2026-10-01T10:00:00Z');
  const all = [root, c('r2', 'b', '2026-10-01T12:00:00Z', 'r'), c('r1', 'a', '2026-10-01T11:00:00Z', 'r'), c('x', 'z', '2026-10-01T09:00:00Z'), c('y1', 'q', '2026-10-01T13:00:00Z', 'x')];
  it('repliesOf returns the replies of one root, oldest first', () => {
    expect(repliesOf(all, 'r').map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(repliesOf(all, 'none')).toEqual([]);
  });
  it('participants are distinct authors in order, root first, skipping deleted users', () => {
    expect(participants(root, repliesOf(all, 'r'))).toEqual(['a', 'b']);
    expect(participants(root, [c('n', null, '2026-10-01T14:00:00Z', 'r'), c('m', 'm', '2026-10-01T15:00:00Z', 'r')])).toEqual(['a', 'm']);
  });
  it('repliesLabel pluralises', () => {
    expect(repliesLabel(1)).toBe('1 reply');
    expect(repliesLabel(4)).toBe('4 replies');
  });
  it('a resolved thread is collapsed by default, an explicit choice wins', () => {
    const done = c('d', 'a', '2026-10-01T10:00:00Z', null, { resolved_at: '2026-10-01T11:00:00Z' });
    expect(threadOpen(root, null)).toBe(true);
    expect(threadOpen(done, null)).toBe(false);
    expect(threadOpen(done, true)).toBe(true);
    expect(threadOpen(root, false)).toBe(false);
  });
});
