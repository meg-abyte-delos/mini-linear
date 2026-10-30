import { describe, expect, it } from 'vitest';
import { autoTitle, describeChanges, normalizeUrl, referencedIds, summarize } from '@/lib/issues/activity-attachments';

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
    expect(c.map((x) => x.text)).toEqual(['changed status from Todo to In Progress', 'changed priority from No priority to Urgent', 'set assignee to a former member',
      'cleared cycle (was a deleted cycle)', 'updated the description', 'added a deleted label and a deleted label and removed a deleted label']);
  });
  it('summarizes known and unknown entities', () => {
    expect(summarize('issue', 'create', {})).toBe('created the issue');
    expect(summarize('issue', 'update', { title: { before: 'a', after: 'b' } })).toBe('changed title from a to b');
    expect(summarize('comment', 'create', {})).toBe('commented');
    expect(summarize('attachment', 'create', { title: { before: null, after: 'Spec.pdf' } })).toBe('attached Spec.pdf');
    expect(summarize('issue_relation', 'create', { type: { before: null, after: 'blocked_by' } })).toBe('added a blocked by relation');
  });
});

describe('activity names', () => {
  const P = '00000000-0000-4000-8000-000000000004', U = '00000000-0000-4000-8000-000000000082', L1 = '00000000-0000-4000-8000-0000000000a1', L2 = '00000000-0000-4000-8000-0000000000a2';
  const names = { project_id: new Map([[P, 'Mini Linear']]), assignee_id: new Map([[U, 'Jonas']]), label_ids: new Map([[L1, 'Improvement']]) };
  it('resolves ids to names per field', () => {
    expect(describeChanges({ project_id: { before: null, after: P } }, names)[0]!.text).toBe('set project to Mini Linear');
    expect(describeChanges({ assignee_id: { before: null, after: U } }, names)[0]!.text).toBe('set assignee to Jonas');
    expect(describeChanges({ label_ids: { before: [], after: [L1] } }, names)[0]!.text).toBe('added Improvement');
    expect(describeChanges({ status: { before: 'in_progress', after: 'backlog' } })[0]!.text).toBe('changed status from In Progress to Backlog');
  });
  it('falls back for entities that no longer exist, never printing the id', () => {
    expect(describeChanges({ project_id: { before: P, after: null } })[0]!.text).toBe('cleared project (was a deleted project)');
    expect(describeChanges({ cycle_id: { before: null, after: U } })[0]!.text).toBe('set cycle to a deleted cycle');
    expect(describeChanges({ assignee_id: { before: null, after: U } })[0]!.text).toBe('set assignee to a former member');
    expect(describeChanges({ label_ids: { before: [L1], after: [L1, L2] } }, names)[0]!.text).toBe('added a deleted label');
  });
  it('lists several labels and collects referenced ids', () => {
    const n = { label_ids: new Map([[L1, 'A'], [L2, 'B']]) };
    expect(describeChanges({ label_ids: { before: [], after: [L1, L2] } }, n)[0]!.text).toBe('added A and B');
    expect(referencedIds([{ project_id: { before: P, after: null }, label_ids: { before: [L1], after: [L2] }, title: { before: 'a', after: 'b' } }])).toMatchObject({ project_id: [P], label_ids: [L1, L2], assignee_id: [] });
  });
});
