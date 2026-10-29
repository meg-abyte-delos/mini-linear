// Browser realtime client: consumes /api/v1/w/:slug/events (SSE), refetches changed entities through the authorised
// GET endpoints and applies them to the store. EventSource reconnects by itself and resends Last-Event-ID.
import type { Entity } from './merge';
import type { SyncStore } from './store';
import type { FeedEvent } from './server/feed';

export type ConnState = 'connecting' | 'live' | 'offline' | 'signed_out';
type ES = { onopen: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; addEventListener(t: string, f: (e: { data: string; lastEventId?: string }) => void): void; close(): void; readyState: number };
export type RealtimeOptions = {
  slug: string; store: SyncStore;
  /** called on `resync` (cursor too old / unknown): reload the lists from scratch */
  onResync: () => void | Promise<void>;
  onState?: (s: ConnState) => void;
  onReconnect?: () => void; // e.g. queue.online()
  /** `presence` event: full viewer list of one issue (empty = nobody). */
  onPresence?: (p: { issue_id: string; viewers: string[]; count: number }) => void;
  eventSource?: (url: string) => ES;
  fetch?: typeof fetch;
};
const PATH: Record<string, string> = { issue: 'issues', comment: 'comments' };
export const EVENT_TYPES = ['issue.create', 'issue.update', 'issue.delete', 'comment.create', 'comment.update', 'comment.delete'] as const;

export function connectRealtime(o: RealtimeOptions): { close(): void; handle(e: FeedEvent): Promise<void> } {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const handle = async (e: FeedEvent) => {
    const known = o.store.confirmed(e.entity, e.entity_id);
    if (known && known.version >= e.version && e.op !== 'delete') return; // our own write, already applied
    if (e.op === 'delete') { o.store.applyRemote({ op: 'delete', type: e.entity, id: e.entity_id, version: e.version }); return; }
    try {
      const r = await f(`/api/v1/w/${o.slug}/${PATH[e.entity]}/${e.entity_id}`);
      if (r.ok) o.store.applyRemote({ op: 'upsert', type: e.entity, row: (await r.json()) as Entity });
      else if (r.status === 404) o.store.applyRemote({ op: 'delete', type: e.entity, id: e.entity_id, version: e.version });
    } catch { /* next event or resync will catch up */ }
  };
  let wasLive = false; let closed = false;
  const mk = o.eventSource ?? ((u: string) => new EventSource(u, { withCredentials: true }) as unknown as ES);
  o.onState?.('connecting');
  const es = mk(`/api/v1/w/${o.slug}/events`);
  // serialise handling so the store sees events in feed order
  let chain: Promise<void> = Promise.resolve();
  for (const t of EVENT_TYPES) es.addEventListener(t, (m) => { chain = chain.then(() => handle(JSON.parse(m.data) as FeedEvent)); });
  es.addEventListener('resync', () => { chain = chain.then(async () => { await o.onResync(); }); });
  es.addEventListener('presence', (m) => { try { o.onPresence?.(JSON.parse(m.data)); } catch { /* malformed frame */ } });
  es.addEventListener('auth', () => { closed = true; es.close(); o.onState?.('signed_out'); });
  es.onopen = () => { o.onState?.('live'); if (wasLive) o.onReconnect?.(); wasLive = true; };
  es.onerror = () => { if (!closed) o.onState?.('offline'); };
  return { close() { closed = true; es.close(); }, handle };
}

/** Presence heartbeat for an open issue. Returns stop(). Calls onViewers with the user ids viewing it. */
export function watchPresence(slug: string, issueId: string, onViewers: (ids: string[]) => void, opts: { intervalMs?: number; fetch?: typeof fetch } = {}): () => void {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = `/api/v1/w/${slug}/issues/${issueId}/presence`;
  let stopped = false;
  const beat = async () => {
    try { const r = await f(url, { method: 'POST' }); if (r.ok && !stopped) onViewers(((await r.json()) as { viewers: { user_id: string }[] }).viewers.map((v) => v.user_id)); } catch { /* offline */ }
  };
  void beat();
  const t = setInterval(() => { void beat(); }, opts.intervalMs ?? 10_000);
  return () => { stopped = true; clearInterval(t); void f(url, { method: 'DELETE' }).catch(() => undefined); };
}
