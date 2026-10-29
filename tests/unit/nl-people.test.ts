import { describe, expect, it } from 'vitest';
import { parseNlCommand } from '@/lib/nl-command';
import { fetchNlPeople, nameFromEmail, toNlPeople } from '@/lib/nl-people';

const ME = '0192f1a0-0000-7000-8000-000000000001';
const ADA = '0192f1a0-0000-7000-8000-000000000003';
const members = [
  { user_id: ME, email: 'meg.abyte@delos.so' },
  { user_id: ADA, email: 'ada.byte@delos.so' },
  { user_id: 'u9', email: 'mock.user@delos.so' }, // non-UUID: dropped
];
const people = toNlPeople(members, { id: ME, email: 'meg.abyte@delos.so', display_name: null });
const p = (s: string) => parseNlCommand(s, people.users, [], people.me);

describe('nl-command on API people', () => {
  it('"assign to me, urgent" keeps the session user', () => {
    expect(p('assign to me, urgent')?.patch).toEqual({ assignee_id: ME, priority: 1 });
  });
  it('"assign to <member>" resolves the member UUID', () => {
    expect(p('assign to Ada, high priority')?.patch).toEqual({ assignee_id: ADA, priority: 2 });
    expect(p('assign to ada byte')?.patch).toEqual({ assignee_id: ADA });
  });
  it('unknown name -> no assignee', () => {
    expect(p('assign to Zorglub')).toBeNull();
    expect(p('assign to Zorglub, urgent')?.patch).toEqual({ priority: 1 });
    expect(p('assign to mock')).toBeNull(); // non-UUID member filtered out
  });
  it('keeps only UUID ids', () => {
    expect(people.users.map((u) => u.id)).toEqual([ME, ADA]);
    expect(toNlPeople(members, { id: 'u1' }).me).toBeNull();
  });
  it('derives names from email', () => {
    expect(nameFromEmail('ada.byte@delos.so')).toBe('Ada Byte');
    expect(people.users[0]!.name).toBe('Meg Abyte');
    expect(toNlPeople(members, { id: ME, display_name: 'Meg' }).users[0]!.name).toBe('Meg');
  });
  it('fetchNlPeople reads /me and paginated members', async () => {
    const f = (async (url: string) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url === '/api/v1/me') return json({ id: ME, email: 'meg.abyte@delos.so', display_name: null });
      if (url.includes('cursor=c2')) return json({ items: [members[1]], next_cursor: null });
      return json({ items: [members[0]], next_cursor: 'c2' });
    }) as typeof fetch;
    const r = await fetchNlPeople('demo', f);
    expect(r.me).toBe(ME);
    expect(r.users.map((u) => u.id)).toEqual([ME, ADA]);
  });
  it('fetchNlPeople never throws', async () => {
    const f = (async () => { throw new Error('down'); }) as typeof fetch;
    expect(await fetchNlPeople('demo', f)).toEqual({ users: [], me: null });
  });
});
