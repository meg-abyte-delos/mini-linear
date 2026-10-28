import { describe, it, expect } from 'vitest';
import { mockInboxClient, httpInboxClient, snoozePresets } from '../../src/lib/inbox-client';

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
      'GET /api/v1/w/acme/notifications?limit=100&archived=true', 'GET /api/v1/w/acme/notifications?limit=100&snoozed=true',
      'GET /api/v1/w/acme/notifications?limit=100&unread=true', 'PUT /api/v1/w/acme/notification-preferences']);
  });
});
