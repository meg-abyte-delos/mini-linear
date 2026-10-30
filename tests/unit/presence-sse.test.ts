import { describe, expect, it, vi } from 'vitest';
import { connectRealtime } from '@/lib/sync/realtime';
import { startIssueRealtime } from '@/lib/realtime-bridge';
import { SyncStore } from '@/lib/sync/store';
import { publishPresence, presenceOf, resetPresence, onPresenceEvent } from '@/lib/presence';

type L = (e: { data: string }) => void;
const fakeES = () => {
  const ls = new Map<string, L[]>();
  const es = { onopen: null as null | ((e: unknown) => void), onerror: null as null | ((e: unknown) => void), readyState: 1, close: vi.fn(),
    addEventListener: (t: string, f: L) => { ls.set(t, [...(ls.get(t) ?? []), f]); } };
  const fire = (t: string, d: unknown) => { for (const f of ls.get(t) ?? []) f({ data: JSON.stringify(d) }); };
  return { es, fire };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('presence over SSE', () => {
  it('connectRealtime forwards `presence` events', async () => {
    const { es, fire } = fakeES(); const got: unknown[] = [];
    connectRealtime({ slug: 'w1', store: new SyncStore(), onResync: vi.fn(), onPresence: (p) => got.push(p), eventSource: () => es });
    fire('presence', { issue_id: 'a', viewers: ['u1'], count: 1 });
    await flush();
    expect(got).toEqual([{ issue_id: 'a', viewers: ['u1'], count: 1 }]);
  });
  it('publishPresence replaces the list and empties on count 0', () => {
    resetPresence();
    publishPresence({ issue_id: 'a', viewers: ['u1', 'u2'], count: 2 });
    expect(presenceOf('a')).toEqual({ viewers: ['u1', 'u2'], count: 2 });
    publishPresence({ issue_id: 'a', viewers: ['u2'], count: 1 });
    expect(presenceOf('a').viewers).toEqual(['u2']);
    publishPresence({ issue_id: 'a', viewers: [], count: 0 });
    expect(presenceOf('a')).toEqual({ viewers: [], count: 0 });
  });
  it('resync race: a snapshot sent right after `resync` lands after the reset, never wiped by it', async () => {
    resetPresence(); publishPresence({ issue_id: 'old', viewers: ['ghost'], count: 1 });
    const { es, fire } = fakeES();
    connectRealtime({ slug: 'w1', store: new SyncStore(), onResync: async () => { await new Promise((r) => setTimeout(r, 5)); resetPresence(); }, onPresence: publishPresence, eventSource: () => es });
    fire('resync', { cursor: '1' });
    fire('presence', { issue_id: 'new', viewers: ['u1'], count: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(presenceOf('old').count).toBe(0);
    expect(presenceOf('new')).toEqual({ viewers: ['u1'], count: 1 });
  });
  it('bridge: resetPresence on reconnect and on resync, snapshot of the new stream kept', async () => {
    resetPresence();
    const { es, fire } = fakeES();
    const stop = startIssueRealtime({ slug: 'w', known: () => undefined, upsert: vi.fn(), remove: vi.fn(), resync: vi.fn(), onPresence: publishPresence, eventSource: () => es });
    es.onopen?.({});
    fire('presence', { issue_id: 'i1', viewers: ['u1'], count: 1 }); await flush();
    expect(presenceOf('i1').count).toBe(1);
    es.onopen?.({}); await flush(); // reconnect
    expect(presenceOf('i1').count).toBe(0);
    fire('presence', { issue_id: 'i2', viewers: ['u2'], count: 1 });
    fire('resync', {}); await flush();
    expect(presenceOf('i2').count).toBe(0);
    stop(); resetPresence();
  });
  it('onPresenceEvent listeners get events, not resets, and stop after unsubscribe', () => {
    resetPresence();
    const got: unknown[] = []; const off = onPresenceEvent((p) => got.push(p));
    publishPresence({ issue_id: 'a', viewers: ['u1'], count: 1 });
    resetPresence();
    off();
    publishPresence({ issue_id: 'a', viewers: ['u2'], count: 1 });
    expect(got).toEqual([{ issue_id: 'a', viewers: ['u1'], count: 1 }]);
    resetPresence();
  });
});
