import { describe, it, expect, vi } from 'vitest';
import { searchApi, searchLocal, snippetParts, looksLikeIdentifier } from '@/lib/search-client';
import type { Issue } from '@/lib/issues';

const iss = (id: string, title: string, description = ''): Issue => ({ id, title, description, status: 'todo' } as Issue);

describe('search client', () => {
  it('builds the request and parses the page', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const f = vi.fn(async (_u: string) => new Response(JSON.stringify({ items: [{ kind: 'issue', id: 'a' }], next_cursor: 'c' })));
    const r = await searchApi('acme', ' foo bar ', { kind: 'issue', limit: 8, cursor: 'x' }, f as unknown as typeof fetch);
    expect(f.mock.calls[0]![0]).toBe('/api/v1/w/acme/search?q=foo+bar&kind=issue&limit=8&cursor=x');
    expect(r).toEqual({ items: [{ kind: 'issue', id: 'a' }], next_cursor: 'c' });
  });
  it('returns null on HTTP error or network failure', async () => {
    expect(await searchApi('a', 'xx', {}, (async () => new Response('{}', { status: 500 })) as typeof fetch)).toBeNull();
    expect(await searchApi('a', 'xx', {}, (async () => { throw new Error('net'); }) as typeof fetch)).toBeNull();
  });
  it('local search: identifier first, then title, then description; short query empty', () => {
    const l = [iss('DEL-2', 'other', 'mentions parser'), iss('DEL-1', 'Parser port'), iss('DEL-3', 'unrelated')];
    expect(searchLocal(l, 'parser').items.map((h) => h.id)).toEqual(['DEL-1', 'DEL-2']);
    expect(searchLocal(l, 'del-3').items.map((h) => h.id)).toEqual(['DEL-3']);
    expect(searchLocal(l, 'p').items).toEqual([]);
    expect(searchLocal(l, 'parser', 'comment').items).toEqual([]);
    expect(searchLocal(l, 'parser', undefined, 1).items).toHaveLength(1);
  });
  it('snippet parts split on mark tags without HTML', () => {
    expect(snippetParts('a <mark>b</mark> c')).toEqual([{ text: 'a ', mark: false }, { text: 'b', mark: true }, { text: ' c', mark: false }]);
    expect(snippetParts('<script>x</script>')[0]).toEqual({ text: '<script>x</script>', mark: false });
  });
  it('identifier detection', () => { expect(looksLikeIdentifier('DEL-12')).toBe(true); expect(looksLikeIdentifier('del 12')).toBe(false); });
});
