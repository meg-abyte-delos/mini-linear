import { describe, it, expect } from 'vitest';
import { buildDigest, NoopDigestSender, setDigestSender, getDigestSender, type DigestItem } from '../../src/lib/digest';

const it1: DigestItem = { type: 'comment', identifier: 'ENG-2', title: 'B', actorEmail: 'a@x.io', createdAt: '2026-01-02T00:00:00Z' };
describe('digest', () => {
  it('returns null when empty', () => expect(buildDigest('u@x.io', [])).toBeNull());
  it('groups by fixed type order, newest first, pluralises', () => {
    const d = buildDigest('u@x.io', [it1, { ...it1, identifier: 'ENG-3', createdAt: '2026-01-03T00:00:00Z' }, { type: 'assigned', identifier: 'ENG-1', title: 'A', actorEmail: null, createdAt: '2026-01-01T00:00:00Z' }])!;
    expect(d.count).toBe(3); expect(d.subject).toBe('3 unread notifications');
    expect(d.text.indexOf('Assigned')).toBeLessThan(d.text.indexOf('New comment'));
    expect(d.text.indexOf('ENG-3')).toBeLessThan(d.text.indexOf('ENG-2'));
  });
  it('singular subject; default sender is a no-op and swappable', async () => {
    expect(buildDigest('u@x.io', [it1])!.subject).toBe('1 unread notification');
    expect(getDigestSender()).toBeInstanceOf(NoopDigestSender);
    await expect(getDigestSender().send(buildDigest('u@x.io', [it1])!)).resolves.toBeUndefined();
    const got: string[] = []; setDigestSender({ send: async (d) => { got.push(d.to); } });
    await getDigestSender().send(buildDigest('u@x.io', [it1])!); expect(got).toEqual(['u@x.io']);
    setDigestSender(new NoopDigestSender());
  });
});
