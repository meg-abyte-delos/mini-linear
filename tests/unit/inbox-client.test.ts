import { describe, it, expect } from 'vitest';
import { mockInboxClient, httpInboxClient, snoozePresets, groupByIssue, unreadRows, shortWhen, whoLabel, type Notif } from '../../src/lib/inbox-client';

describe('snoozePresets', () => {
  it('computes later/tomorrow/next Monday relative to now', () => {
    const now = new Date(2026, 9, 28, 16, 0); // Wed
    const [later, tom, mon] = snoozePresets(now) as unknown as { until: string }[];
    expect(new Date(later!.until).getTime() - now.getTime()).toBe(3 * 3600e3);
    const t = new Date(tom!.until); expect([t.getDate(), t.getHours()]).toEqual([29, 9]);
    const m = new Date(mon!.until); expect([m.getDay(), m.getDate(), m.getHours()]).toEqual([1, 2, 9]);
  });
  it('on a Monday, next week is 7 days out', () => {
    const m = new Date(snoozePresets(new Date(2026, 9, 26, 10, 0))[2]!.until);
    expect([m.getDay(), m.getDate()]).toEqual([1, 2]);
  });
});

describe('mock inbox client tabs', () => {
  it('moves rows between All, Snoozed and Archived', async () => {
    const c = mockInboxClient();
    expect((await c.list('all')).items).toHaveLength(3);
    expect((await c.list('unread')).items).toHaveLength(2);
    await c.act('n1', 'archive'); await c.act('n2', 'snooze', new Date(Date.now() + 3600e3).toISOString());
    expect((await c.list('all')).items.map((n) => n.id)).toEqual(['n3']);
    expect((await c.list('archived')).items.map((n) => n.id)).toEqual(['n1']);
    expect((await c.list('snoozed')).items.map((n) => n.id)).toEqual(['n2']);
    await c.act('n1', 'unarchive');
    expect((await c.list('all')).items.map((n) => n.id).sort()).toEqual(['n1', 'n3']);
  });
  it('prefs update is partial', async () => {
    const c = mockInboxClient();
    const p = await c.putPrefs({ comment: { email: true } });
    expect(p?.comment).toEqual({ in_app: true, email: true });
    expect(p?.mention).toEqual({ in_app: true, email: false });
  });
});

describe('http inbox client', () => {
  it('maps tabs to query params and prefs to PUT', async () => {
    const urls: string[] = [];
    const f = (async (u: string, init?: RequestInit) => { urls.push(`${init?.method ?? 'GET'} ${u}`); return new Response(JSON.stringify({ items: [], unread_count: 0, preferences: {} })); }) as unknown as typeof fetch;
    const c = httpInboxClient('acme', f);
    await c.list('archived'); await c.list('snoozed'); await c.list('unread'); await c.putPrefs({ mention: { email: true } });
    expect(urls).toEqual([
      'GET /api/v1/w/acme/notifications?limit=100&archived=true', 'GET /api/v1/w/acme/notifications?limit=100',
      'GET /api/v1/w/acme/notifications?limit=100&snoozed=true', 'GET /api/v1/w/acme/notifications?limit=100',
      'GET /api/v1/w/acme/notifications?limit=100&unread=true', 'PUT /api/v1/w/acme/notification-preferences']);
  });
});


const notif = (id: string, issue: string, at: string, read: string | null, over: Partial<Notif> = {}): Notif => ({
  id, type: 'comment', issue_id: issue, comment_id: null, actor_id: 'u1', read_at: read, archived_at: null, snoozed_until: null, created_at: at,
  issue: { id: issue, number: 1, title: 'T', status: 'in_review', team_id: 't', identifier: 'DEL-1' }, actor: { id: 'u1', email: 'sam@x.io' }, ...over,
});

describe('groupByIssue', () => {
  it('keeps one row per issue, the latest event, unread if any member is', () => {
    const a = notif('a', 'i1', '2026-10-30T08:00:00Z', null);
    const b = notif('b', 'i1', '2026-10-30T09:00:00Z', '2026-10-30T09:30:00Z');
    const c = notif('c', 'i2', '2026-10-30T07:00:00Z', '2026-10-30T07:10:00Z');
    const { rows, members } = groupByIssue([a, c, b]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c']);
    expect(rows[0]!.read_at).toBeNull();
    expect(rows[1]!.read_at).not.toBeNull();
    expect(members.get('b')!.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});

describe('shortWhen', () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime();
  it('is relative within a day, then a short date', () => {
    expect(shortWhen(new Date(now - 20e3).toISOString(), now)).toBe('just now');
    expect(shortWhen(new Date(now - 5 * 60e3).toISOString(), now)).toBe('5m ago');
    expect(shortWhen(new Date(now - 3 * 3600e3).toISOString(), now)).toBe('3h ago');
    expect(shortWhen(new Date(2026, 9, 28, 10, 5).toISOString(), now)).toBe('Oct 28, 10:05');
    expect(shortWhen(new Date(2025, 11, 1, 9, 0).toISOString(), now)).toBe('Dec 1, 2025, 09:00');
  });
  it('never says just now for a future date (Snoozed until)', () => {
    expect(shortWhen(new Date(now + 30e3).toISOString(), now)).toBe('in 1m');
    expect(shortWhen(new Date(now + 2 * 3600e3 + 60e3).toISOString(), now)).toBe('in 2h');
    expect(shortWhen(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe('Nov 2, 09:00');
  });
});

describe('whoLabel', () => {
  it('says Due soon for system notifications and tolerates a missing kind', () => {
    expect(whoLabel(notif('a', 'i', '2026-10-30T08:00:00Z', null, { type: 'due_soon', actor: null, actor_id: null, kind: 'system' }))).toBe('Due soon');
    expect(whoLabel(notif('a', 'i', '2026-10-30T08:00:00Z', null))).toBe('sam commented');
    expect(whoLabel(notif('a', 'i', '2026-10-30T08:00:00Z', null, { actor: null, actor_id: null }))).toBe('Someone commented');
  });
});

describe('unreadRows', () => {
  it('counts unread rows after grouping by issue, not events', () => {
    const items = [notif('a', 'i1', '2026-10-30T08:00:00Z', null), notif('b', 'i1', '2026-10-30T09:00:00Z', null), notif('c', 'i2', '2026-10-30T07:00:00Z', null), notif('d', 'i3', '2026-10-30T06:00:00Z', '2026-10-30T06:30:00Z')];
    expect(unreadRows(items)).toBe(2);
  });
});
