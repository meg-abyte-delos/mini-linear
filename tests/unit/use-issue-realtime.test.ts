import { describe, it, expect, vi } from 'vitest';
import { isGone } from '../../src/lib/detail/use-issue-realtime';

const f = (status: number) => vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;

describe('isGone (resync deletion check)', () => {
  it('is true only for a confirmed 404', async () => {
    expect(await isGone('demo', 'i1', f(404))).toBe(true);
    for (const s of [200, 403, 500, 503]) expect(await isGone('demo', 'i1', f(s))).toBe(false);
  });
  it('a network failure is not a deletion', async () => {
    expect(await isGone('demo', 'i1', (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toBe(false);
  });
});
