import { describe, it, expect, vi } from 'vitest';
import { detailApi } from '@/lib/detail/api';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('detailApi feature detection', () => {
  it('reports unsupported on 404/405', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(405));
    const a = detailApi('delos', f as unknown as typeof fetch);
    expect(await a.relations('x')).toEqual({ ok: false, unsupported: true, status: 404 });
    expect(await a.attachments('x')).toEqual({ ok: false, unsupported: true, status: 405 });
  });
  it('reports real errors as supported failures', async () => {
    const f = vi.fn().mockResolvedValue(res(500));
    expect(await detailApi('delos', f as unknown as typeof fetch).activity('x')).toEqual({ ok: false, unsupported: false, status: 500 });
  });
  it('sends JSON bodies on the contract paths', async () => {
    const f = vi.fn().mockResolvedValue(res(201, { id: 'r1' }));
    const a = detailApi('de los', f as unknown as typeof fetch);
    const r = await a.addRelation('i1', 'blocks', 'i2');
    expect(r).toEqual({ ok: true, data: { id: 'r1' } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/v1/w/de%20los/issues/i1/relations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ type: 'blocks', related_issue_id: 'i2' });
    expect(init.headers['content-type']).toBe('application/json');
  });
  it('handles 204 and network errors', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(204)).mockRejectedValueOnce(new Error('net'));
    const a = detailApi('delos', f as unknown as typeof fetch);
    expect(await a.react('c1', '👍', true)).toEqual({ ok: true, data: null });
    expect(await a.archive('i1', true)).toEqual({ ok: false, unsupported: false, status: 0 });
  });
});
