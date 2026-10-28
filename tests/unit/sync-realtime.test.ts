import { describe, expect, it, vi } from 'vitest';
import { frame } from '@/lib/sync/server/sse';
import { parseCursor } from '@/lib/sync/server/feed';
import { connectRealtime } from '@/lib/sync/realtime';
import { SyncStore } from '@/lib/sync/store';

describe('SSE framing (R-6)', () => {
  it('payload with newlines, emoji and "data:" stays one valid JSON data line', () => {
    const s = frame({ id: '7', event: 'issue.update', data: { title: 'a\nb\r\ndata: x 🚀' } });
    expect(s.startsWith('id: 7\nevent: issue.update\n')).toBe(true);
    expect(s.endsWith('\n\n')).toBe(true);
    const lines = s.trimEnd().split('\n');
    expect(lines.filter((l) => l.startsWith('data: '))).toHaveLength(1);
    expect(JSON.parse(lines[2]!.slice(6))).toEqual({ title: 'a\nb\r\ndata: x 🚀' });
  });
});

describe('parseCursor (R-3 bad Last-Event-ID never 500)', () => {
  it.each([[null, null], ['', null], ['abc', null], ['-1', null], ['1.5', null], ['99999999999999999999', null], ['0', 0n], [' 42 ', 42n]])('%s', (v, want) => {
    expect(parseCursor(v as string | null)).toBe(want);
  });
});

type L = (e: { data: string }) => void;
const fakeES = () => {
  const ls = new Map<string, L[]>();
  const es = { onopen: null as null | ((e: unknown) => void), onerror: null as null | ((e: unknown) => void), readyState: 1, close: vi.fn(),
    addEventListener: (t: string, f: L) => { ls.set(t, [...(ls.get(t) ?? []), f]); } };
  const fire = (t: string, d: unknown) => { for (const f of ls.get(t) ?? []) f({ data: JSON.stringify(d) }); };
  return { es, fire };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('connectRealtime', () => {
  it('refetches changed issues into the store, in feed order; delete removes', async () => {
    const { es, fire } = fakeES(); const store = new SyncStore();
    const f = vi.fn(async (u: string) => new Response(JSON.stringify({ id: u.split('/').pop(), version: 2, title: 'srv' }), { status: 200 }));
    const states: string[] = [];
    connectRealtime({ slug: 'w1', store, onResync: vi.fn(), onState: (s) => states.push(s), eventSource: () => es, fetch: f as never });
    es.onopen?.({});
    fire('issue.create', { id: '1', entity: 'issue', entity_id: 'a', issue_id: 'a', op: 'create', version: 2 });
    await flush();
    expect(f).toHaveBeenCalledWith('/api/v1/w/w1/issues/a');
    expect(store.get('issue', 'a')?.title).toBe('srv');
    fire('issue.delete', { id: '2', entity: 'issue', entity_id: 'a', issue_id: 'a', op: 'delete', version: 3 });
    await flush();
    expect(store.get('issue', 'a')).toBeNull();
    expect(states).toEqual(['connecting', 'live']);
  });
  it('skips the refetch for a version it already has (own write echo)', async () => {
    const { es, fire } = fakeES(); const store = new SyncStore();
    store.applyRemote({ op: 'upsert', type: 'issue', row: { id: 'a', version: 5 } });
    const f = vi.fn();
    connectRealtime({ slug: 'w1', store, onResync: vi.fn(), eventSource: () => es, fetch: f as never });
    fire('issue.update', { id: '9', entity: 'issue', entity_id: 'a', issue_id: 'a', op: 'update', version: 5 });
    await flush();
    expect(f).not.toHaveBeenCalled();
  });
  it('404 on refetch (lost access) drops the entity; resync calls onResync; auth closes', async () => {
    const { es, fire } = fakeES(); const store = new SyncStore();
    store.applyRemote({ op: 'upsert', type: 'issue', row: { id: 'a', version: 1 } });
    const onResync = vi.fn(); const states: string[] = [];
    connectRealtime({ slug: 'w1', store, onResync, onState: (s) => states.push(s), eventSource: () => es, fetch: (async () => new Response(null, { status: 404 })) as never });
    fire('issue.update', { id: '3', entity: 'issue', entity_id: 'a', issue_id: 'a', op: 'update', version: 2 });
    fire('resync', { cursor: '10' });
    await flush(); await flush();
    expect(store.get('issue', 'a')).toBeNull();
    expect(onResync).toHaveBeenCalledOnce();
    fire('auth', { status: 401 });
    expect(es.close).toHaveBeenCalled();
    expect(states.at(-1)).toBe('signed_out');
  });
  it('reconnect after an error calls onReconnect (flush the offline queue)', () => {
    const { es } = fakeES(); const onReconnect = vi.fn(); const states: string[] = [];
    connectRealtime({ slug: 'w1', store: new SyncStore(), onResync: vi.fn(), onReconnect, onState: (s) => states.push(s), eventSource: () => es });
    es.onopen?.({}); es.onerror?.({}); es.onopen?.({});
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(states).toEqual(['connecting', 'live', 'offline', 'live']);
  });
});
