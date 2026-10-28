import { describe, expect, it } from 'vitest';
import { autoTitle, describeChanges, normalizeUrl, summarize } from '@/lib/issues/activity-attachments';

describe('attachment url validation', () => {
  it('accepts http(s) and normalizes', () => {
    expect(normalizeUrl(' https://Example.com/a b ')).toBe('https://example.com/a%20b');
    expect(normalizeUrl('http://x.io')).toBe('http://x.io/');
  });
  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.io/f', 'notaurl', '//x.io', 'https://u:p@x.io/'])('rejects %s', (u) => {
    expect(() => normalizeUrl(u)).toThrow();
  });
});

describe('autoTitle', () => {
  it('uses the file name for files and host+path for links', () => {
    expect(autoTitle('https://cdn.x.io/up/Spec%20v2.pdf?sig=1', 'file')).toBe('Spec v2.pdf');
    expect(autoTitle('https://www.github.com/acme/app/pull/12?x=1', 'link')).toBe('github.com/acme/app/pull/12');
    expect(autoTitle('https://figma.com/', 'file')).toBe('figma.com');
    expect(autoTitle(`https://x.io/${'a'.repeat(400)}`, 'link')).toHaveLength(255);
  });
});

describe('activity text', () => {
  it('describes field diffs', () => {
    const c = describeChanges({ status: { before: 'todo', after: 'in_progress' }, priority: { before: 0, after: 1 }, assignee_id: { before: null, after: 'u1' },
      cycle_id: { before: 'c1', after: null }, description: { before: 'a', after: 'b' }, label_ids: { before: ['a'], after: ['b', 'c'] }, issue_id: { before: null, after: 'i' } });
    expect(c.map((x) => x.text)).toEqual(['changed status from todo to in progress', 'changed priority from No priority to Urgent', 'set assignee to u1',
      'cleared cycle (was c1)', 'updated the description', 'added 2 labels and removed 1 label']);
  });
  it('summarizes known and unknown entities', () => {
    expect(summarize('issue', 'create', {})).toBe('created the issue');
    expect(summarize('issue', 'update', { title: { before: 'a', after: 'b' } })).toBe('changed title from a to b');
    expect(summarize('comment', 'create', {})).toBe('commented');
    expect(summarize('attachment', 'create', { title: { before: null, after: 'Spec.pdf' } })).toBe('attached Spec.pdf');
    expect(summarize('issue_relation', 'create', { type: { before: null, after: 'blocked_by' } })).toBe('added a blocked by relation');
  });
});
