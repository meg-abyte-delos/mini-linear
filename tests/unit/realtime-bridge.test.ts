import { describe, expect, it, vi } from 'vitest';
import { startIssueRealtime, fetchAllIssues } from '@/lib/realtime-bridge';

function fakeES() {
  const h = new Map<string, (e: { data: string }) => void>();
  const es = { onopen: null as null | ((e: unknown) => void), onerror: null as null | ((e: unknown) => void), readyState: 1, closed: false,
    addEventListener(t: string, f: (e: { data: string }) => void) { h.set(t, f); }, close() { es.closed = true; } };
  return { es, emit: (t: string, d?: unknown) => h.get(t)?.({ data: JSON.stringify(d ?? {}) }) };
}
const ev = (op: 'create' | 'update' | 'delete', version: number) => ({ id: 'x', entity: 'issue', entity_id: 'i1', issue_id: 'i1', op, version });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('realtime bridge', () => {
  it('fetches and upserts a remote change, skips own write, removes on delete', async () => {
    const f = fakeES(); const known = new Map<string, number>([['i1', 2]]);
    const upsert = vi.fn(); const remove = vi.fn(); const act = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'i1', version: 3, title: 'T' }), { status: 200 }));
    const stop = startIssueRealtime({ slug: 'w', known: (id) => known.get(id), upsert, remove, resync: vi.fn(), onActivity: act, eventSource: () => f.es, fetch: fetchMock as unknown as typeof fetch });
    f.emit('issue.update', ev('update', 2)); await flush();
    expect(upsert).not.toHaveBeenCalled(); // own write already applied
    f.emit('issue.update', ev('update', 3)); await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/w/w/issues/i1');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', version: 3 }));
    f.emit('issue.delete', ev('delete', 4)); await flush();
    expect(remove).toHaveBeenCalledWith('i1');
    expect(act).toHaveBeenCalled();
    stop(); expect(f.es.closed).toBe(true);
  });
  it('resync reloads', async () => {
    const f = fakeES(); const resync = vi.fn(); const act = vi.fn();
    startIssueRealtime({ slug: 'w', known: () => undefined, upsert: vi.fn(), remove: vi.fn(), resync, onActivity: act, eventSource: () => f.es });
    f.emit('resync'); await flush();
    expect(resync).toHaveBeenCalled(); expect(act).toHaveBeenCalled();
  });
  it('fetchAllIssues pages until no cursor', async () => {
    const pages = [{ items: [{ id: 'a' }], next_cursor: 'c1' }, { items: [{ id: 'b' }], next_cursor: null }];
    let n = 0; const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify(pages[n++]), { status: 200 }); }) as unknown as typeof fetch;
    const out = await fetchAllIssues('w', f);
    expect(out.map((i) => i.id)).toEqual(['a', 'b']); expect(urls[1]).toContain('cursor=c1');
  });
});
