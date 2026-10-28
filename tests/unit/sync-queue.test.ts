import { describe, expect, it, vi } from 'vitest';
import { SyncStore } from '@/lib/sync/store';
import { MutationQueue, MAX_CONFLICT_RETRIES, isPendingDelete, type SendResult, type Mutation, type KV } from '@/lib/sync/queue';
import { httpTransport } from '@/lib/sync/transport';

const row = (v: number, x: Record<string, unknown> = {}) => ({ id: 'i1', version: v, title: 'A', status: 'todo', priority: 0, ...x });
const setup = (send: (m: Mutation) => Promise<SendResult>, storage?: KV) => {
  const store = new SyncStore();
  store.applyRemote({ op: 'upsert', type: 'issue', row: row(1) });
  const timers: (() => void)[] = [];
  const onError = vi.fn();
  const q = new MutationQueue({ store, transport: vi.fn(send), storage, onError, setTimer: (fn) => timers.push(fn) });
  return { store, q, timers, onError };
};
const mem = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, get: (k) => m.get(k) ?? null, set: (k, v) => { m.set(k, v); } }; };

describe('MutationQueue', () => {
  it('applies optimistically, then confirms with the server row', async () => {
    let resolve!: (r: SendResult) => void;
    const { store, q } = setup(() => new Promise((r) => { resolve = r; }));
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { status: 'done' } });
    expect(store.get('issue', 'i1')?.status).toBe('done'); // before the server answered
    resolve({ kind: 'ok', row: row(2, { status: 'done' }) });
    await q.settled();
    expect(store.confirmed('issue', 'i1')).toMatchObject({ status: 'done', version: 2 });
    expect(q.pending).toHaveLength(0);
  });
  it('rolls back on a rejected write and reports it', async () => {
    const { store, q, onError } = setup(async () => ({ kind: 'rejected', status: 422 }));
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: '' } });
    await q.settled();
    expect(store.get('issue', 'i1')?.title).toBe('A');
    expect(onError).toHaveBeenCalledOnce();
  });
  it('412: rebases on the fresh row (other fields kept) and retries at the new version', async () => {
    const sent: number[] = [];
    const { store, q } = setup(async (m) => {
      sent.push(m.baseVersion);
      return sent.length === 1 ? { kind: 'conflict', row: row(5, { priority: 4 }) } : { kind: 'ok', row: row(6, { priority: 4, status: 'done' }) };
    });
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { status: 'done' } });
    await q.settled();
    expect(sent).toEqual([1, 5]);
    expect(store.get('issue', 'i1')).toMatchObject({ status: 'done', priority: 4, version: 6 });
  });
  it(`gives up after ${MAX_CONFLICT_RETRIES} conflicts and rolls back to the server copy`, async () => {
    let v = 1;
    const { store, q, onError } = setup(async () => ({ kind: 'conflict', row: row(++v, { title: 'srv' }) }));
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'mine' } });
    await q.settled();
    expect(store.get('issue', 'i1')?.title).toBe('srv');
    expect(onError).toHaveBeenCalledOnce();
  });
  it('offline: keeps the edit, persists, retries in order when back online', async () => {
    let up = false; const order: string[] = [];
    const kv = mem();
    const { store, q, timers } = setup(async (m) => { if (!up) return { kind: 'offline' }; order.push(String(m.fields.title)); return { kind: 'ok', row: row(order.length + 1, { title: m.fields.title }) }; }, kv);
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'one' } });
    await q.settled();
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'two' } });
    expect(q.offline).toBe(true);
    expect(store.get('issue', 'i1')?.title).toBe('two');
    expect(JSON.parse(kv.m.get('ml.sync.queue.v1')!)).toHaveLength(2);
    expect(timers).toHaveLength(1);
    up = true; q.online(); await q.settled();
    expect(order).toEqual(['one', 'two']);
    expect(store.get('issue', 'i1')).toMatchObject({ title: 'two', version: 3 });
    expect(JSON.parse(kv.m.get('ml.sync.queue.v1')!)).toEqual([]);
  });
  it('a thrown transport counts as offline, not as a rollback', async () => {
    const { store, q, onError } = setup(async () => { throw new Error('net'); });
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'x' } });
    await q.settled();
    expect(store.get('issue', 'i1')?.title).toBe('x');
    expect(onError).not.toHaveBeenCalled();
  });
  it('replays a persisted queue after reload (optimistic state restored)', () => {
    const kv = mem();
    kv.set('ml.sync.queue.v1', JSON.stringify([{ key: 'k', type: 'issue', id: 'i1', kind: 'update', fields: { title: 'saved' }, baseVersion: 1, attempts: 0 }]));
    const { store, q } = setup(() => new Promise(() => undefined), kv);
    expect(q.pending).toHaveLength(1);
    expect(store.get('issue', 'i1')?.title).toBe('saved');
  });
  it('corrupt persisted queue is ignored', () => {
    const kv = mem(); kv.set('ml.sync.queue.v1', '{nope');
    expect(setup(async () => ({ kind: 'offline' }), kv).q.pending).toHaveLength(0);
  });
  it('does not clear a field re-edited by a later queued mutation', async () => {
    const res: ((r: SendResult) => void)[] = [];
    const { store, q } = setup(() => new Promise((r) => res.push(r)));
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'one' } });
    q.mutate({ type: 'issue', id: 'i1', kind: 'update', fields: { title: 'two' } });
    res[0]!({ kind: 'ok', row: row(2, { title: 'one' }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get('issue', 'i1')?.title).toBe('two');
  });
  it('create with a temp id: replaced by the server row, later edits retargeted', async () => {
    const sent: Mutation[] = [];
    const { store, q } = setup(async (m) => { sent.push({ ...m }); return m.kind === 'create' ? { kind: 'ok', row: { id: 'srv', version: 1, title: 'n' } } : { kind: 'ok', row: { id: 'srv', version: 2, title: 'n2' } }; });
    q.mutate({ type: 'issue', id: 'tmp', kind: 'create', fields: { id: 'tmp', version: 0, title: 'n' } });
    q.mutate({ type: 'issue', id: 'tmp', kind: 'update', fields: { title: 'n2' } });
    await q.settled(); await q.settled();
    expect(sent[1]).toMatchObject({ id: 'srv', baseVersion: 1 });
    expect(store.get('issue', 'tmp')).toBeNull();
    expect(store.get('issue', 'srv')?.title).toBe('n2');
  });
  it('delete is hidden optimistically, removed on success', async () => {
    let resolve!: (r: SendResult) => void;
    const { store, q } = setup(() => new Promise((r) => { resolve = r; }));
    q.mutate({ type: 'issue', id: 'i1', kind: 'delete' });
    expect(isPendingDelete(store.get('issue', 'i1'))).toBe(true);
    resolve({ kind: 'ok', row: null }); await q.settled();
    expect(store.get('issue', 'i1')).toBeNull();
  });
});

describe('httpTransport', () => {
  const m = (x: Partial<Mutation>): Mutation => ({ key: 'k1', type: 'issue', id: 'i1', kind: 'update', fields: { title: 't' }, baseVersion: 3, attempts: 0, ...x });
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s });
  it('PATCH with If-Match; 200 -> ok', async () => {
    const f = vi.fn(async () => json(200, { id: 'i1', version: 4 }));
    expect(await httpTransport('w1', f as never)(m({}))).toEqual({ kind: 'ok', row: { id: 'i1', version: 4 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/w/w1/issues/i1');
    expect((init.headers as Record<string, string>)['if-match']).toBe('"3"');
  });
  it('412 -> conflict with the refetched row', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(412, {})).mockResolvedValueOnce(json(200, { id: 'i1', version: 7 }));
    expect(await httpTransport('w1', f as never)(m({}))).toEqual({ kind: 'conflict', row: { id: 'i1', version: 7 } });
  });
  it.each([500, 503, 429])('%i -> offline (retry)', async (s) => {
    expect((await httpTransport('w1', (async () => json(s, {})) as never)(m({}))).kind).toBe('offline');
  });
  it('422 -> rejected with message; network error -> offline', async () => {
    expect(await httpTransport('w1', (async () => json(422, { error: { message: 'bad' } })) as never)(m({}))).toEqual({ kind: 'rejected', status: 422, message: 'bad' });
    expect((await httpTransport('w1', (async () => { throw new Error('x'); }) as never)(m({}))).kind).toBe('offline');
  });
  it('create comment posts to the issue; delete sends no body; 204 -> ok(null)', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const t = httpTransport('w1', f as never);
    await t(m({ type: 'comment', id: 'c1', kind: 'create', fields: { issue_id: 'i9', body: 'hi' } }));
    const [u, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(u).toBe('/api/v1/w/w1/issues/i9/comments');
    expect(JSON.parse(init.body as string)).toEqual({ body: 'hi' });
    expect(await t(m({ kind: 'delete' }))).toEqual({ kind: 'ok', row: null });
    expect((f.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBeUndefined();
  });
});
