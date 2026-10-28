import { describe, it, expect } from 'vitest';
import { detailApi } from '@/lib/detail/api';

describe('detailApi comment edit/delete', () => {
  it('PATCH and DELETE carry If-Match with the comment version', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(init?.method === 'DELETE' ? null : JSON.stringify({ id: 'c1', body: 'x' }), { status: init?.method === 'DELETE' ? 204 : 200 }); }) as unknown as typeof fetch;
    const api = detailApi('delos', f);
    const e = await api.editComment('c1', 'x', 3);
    const d = await api.deleteComment('c1', 4);
    expect(e.ok && d.ok).toBe(true);
    expect(calls[0]!.url).toBe('/api/v1/w/delos/comments/c1');
    expect(calls[0]!.init?.method).toBe('PATCH');
    expect((calls[0]!.init?.headers as Record<string, string>)['if-match']).toBe('"3"');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ body: 'x' });
    expect(calls[1]!.init?.method).toBe('DELETE');
    expect((calls[1]!.init?.headers as Record<string, string>)['if-match']).toBe('"4"');
  });
  it('403 and 412 are reported, not unsupported', async () => {
    const f = (async () => new Response('{}', { status: 412 })) as unknown as typeof fetch;
    const r = await detailApi('delos', f).editComment('c1', 'x', 1);
    expect(r).toEqual({ ok: false, unsupported: false, status: 412 });
  });
});
