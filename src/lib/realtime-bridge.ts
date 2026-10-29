// Bridges the SSE change feed (lib/sync/realtime) to the Shell's issue store (API mode). Pure over injected deps so it is unit-testable.
import { connectRealtime, type ConnState } from '@/lib/sync/realtime';
import type { SyncStore } from '@/lib/sync/store';
import type { Issue } from '@/lib/issues';

export type BridgeDeps = {
  slug: string;
  /** Version we already hold for an issue (own writes, earlier events). */
  known: (id: string) => number | undefined;
  /** Put a server row into the local store / drop it. Callers re-render. */
  upsert: (row: Issue) => void;
  remove: (id: string) => void;
  /** Cursor too old: reload everything. */
  resync: () => void | Promise<void>;
  /** Any issue/comment change: inbox & detail panels may refresh. */
  onActivity?: () => void;
  onState?: (s: ConnState) => void;
  onPresence?: (p: { issue_id: string; viewers: string[]; count: number }) => void;
  eventSource?: Parameters<typeof connectRealtime>[0]['eventSource'];
  fetch?: typeof fetch;
};

export function startIssueRealtime(d: BridgeDeps): () => void {
  // Adapter exposing only the two SyncStore methods connectRealtime calls.
  const store = {
    confirmed: (type: string, id: string) => { if (type !== 'issue') return null; const v = d.known(id); return v === undefined ? null : { id, version: v }; },
    applyRemote: (c: { op: string; type: string; id?: string; row?: { id: string } }) => {
      d.onActivity?.();
      if (c.type !== 'issue') return;
      if (c.op === 'delete' && c.id) d.remove(c.id);
      else if (c.op === 'upsert' && c.row) d.upsert(c.row as unknown as Issue);
    },
  } as unknown as SyncStore;
  const c = connectRealtime({ slug: d.slug, store, onResync: async () => { await d.resync(); d.onActivity?.(); }, onReconnect: () => d.onActivity?.(), onState: d.onState, onPresence: d.onPresence, eventSource: d.eventSource, fetch: d.fetch });
  return () => c.close();
}

/** Browser-side full reload of issues (resync). Pages of 100 as the list endpoint serves them. */
export async function fetchAllIssues(slug: string, f: typeof fetch = fetch, cap = 100): Promise<Issue[]> {
  const out: Issue[] = []; let cursor: string | null = null;
  for (let n = 0; n < cap; n++) {
    const r = await f(`/api/v1/w/${slug}/issues?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!r.ok) throw new Error(`issues -> ${r.status}`);
    const b = (await r.json()) as { items: Issue[]; next_cursor: string | null };
    out.push(...b.items);
    if (!b.next_cursor) break; cursor = b.next_cursor;
  }
  return out;
}
