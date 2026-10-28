// Offline-tolerant optimistic mutation queue (FIFO, one request in flight, persisted).
// mutate() applies the edit to the store immediately, persists the queue, then sends. Outcome of each send:
//  ok        -> server row applied, the mutation's pending fields cleared (unless a later queued edit re-set them).
//  conflict  -> HTTP 412: fresh server row applied, pending fields rebased on it (field-level LWW: this client's
//               edited fields win, others take the server value), retried at the new version, max MAX_CONFLICT_RETRIES.
//  offline   -> network error / 5xx / 429: kept, retried with backoff, or at once on online().
//  rejected  -> other 4xx (or conflict retries exhausted): rolled back to the server copy, onError called.
import type { Entity } from './merge';
import type { SyncStore } from './store';

export type Mutation = {
  key: string; // client-generated idempotency key
  type: string; // entity table, e.g. 'issue'
  id: string;
  kind: 'create' | 'update' | 'delete';
  fields: Record<string, unknown>;
  baseVersion: number; // version the edit applies to (0 for create); the transport sends it as If-Match
  attempts: number;
};
export type SendResult =
  | { kind: 'ok'; row: Entity | null }
  | { kind: 'conflict'; row: Entity | null }
  | { kind: 'offline' }
  | { kind: 'rejected'; status: number; message?: string };
export type Transport = (m: Mutation) => Promise<SendResult>;
export interface KV { get(k: string): string | null; set(k: string, v: string): void }

export const MAX_CONFLICT_RETRIES = 3;
export const QUEUE_STORAGE_KEY = 'ml.sync.queue.v1';
const TOMB = '__deleted';

export type QueueOptions = {
  store: SyncStore; transport: Transport; storage?: KV;
  onError?: (m: Mutation, r: SendResult) => void;
  backoff?: (n: number) => number; // ms before offline retry n; default 1s, 2s, 4s .. 30s
  setTimer?: (fn: () => void, ms: number) => unknown;
};

export class MutationQueue {
  private q: Mutation[] = [];
  private running = false;
  private waiting = false;
  private offlineTries = 0;
  private idle: (() => void)[] = [];
  private listeners = new Set<() => void>();

  constructor(private o: QueueOptions) {
    const raw = o.storage?.get(QUEUE_STORAGE_KEY);
    if (raw) {
      try { const v = JSON.parse(raw) as unknown; this.q = Array.isArray(v) ? (v as Mutation[]) : []; } catch { this.q = []; }
      for (const m of this.q) this.o.store.applyLocal(m.type, m.id, this.local(m)); // replay optimistic state after reload
    }
  }

  get pending(): readonly Mutation[] { return this.q; }
  /** true while edits are queued but the server is unreachable (for an offline indicator). */
  get offline(): boolean { return this.waiting; }
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private changed() { this.o.storage?.set(QUEUE_STORAGE_KEY, JSON.stringify(this.q)); for (const l of [...this.listeners]) l(); }
  private local(m: Mutation): Record<string, unknown> { return m.kind === 'delete' ? { [TOMB]: true } : m.fields; }

  mutate(m: { type: string; id: string; kind: Mutation['kind']; fields?: Record<string, unknown>; key?: string }): Mutation {
    const base = this.o.store.confirmed(m.type, m.id);
    const full: Mutation = { type: m.type, id: m.id, kind: m.kind, fields: m.fields ?? {},
      key: m.key ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, baseVersion: base?.version ?? 0, attempts: 0 };
    this.o.store.applyLocal(m.type, m.id, this.local(full));
    this.q.push(full);
    this.changed();
    void this.flush();
    return full;
  }

  /** Resolves when the queue is drained, or parked offline. */
  settled(): Promise<void> { return this.running ? new Promise((r) => this.idle.push(r)) : Promise.resolve(); }
  /** Call on window 'online' and after a realtime reconnect. */
  online() { this.offlineTries = 0; if (this.waiting) { this.waiting = false; void this.flush(); } }

  private settle(m: Mutation) {
    const later = new Set(this.q.filter((x) => x.type === m.type && x.id === m.id).flatMap((x) => Object.keys(this.local(x))));
    this.o.store.clearLocal(m.type, m.id, Object.keys(this.local(m)).filter((k) => !later.has(k)));
  }

  async flush(): Promise<void> {
    if (this.running || this.waiting) return;
    this.running = true;
    try {
      while (this.q.length) {
        const m = this.q[0]!;
        const r = await this.o.transport(m).catch((): SendResult => ({ kind: 'offline' }));
        if (r.kind === 'offline') {
          const n = ++this.offlineTries;
          const ms = this.o.backoff ? this.o.backoff(n) : Math.min(30_000, 1000 * 2 ** (n - 1));
          this.waiting = true;
          (this.o.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t)))(() => this.online(), ms);
          this.changed();
          return;
        }
        this.offlineTries = 0;
        if (r.kind === 'conflict' && r.row && m.attempts < MAX_CONFLICT_RETRIES) {
          m.attempts++;
          this.o.store.applyRemote({ op: 'upsert', type: m.type, row: r.row }); // store keeps pending fields on top
          m.baseVersion = r.row.version;
          this.changed();
          continue;
        }
        this.q.shift();
        if (r.kind === 'ok') {
          if (r.row) this.o.store.applyRemote({ op: 'upsert', type: m.type, row: r.row });
          if (m.kind === 'create' && r.row && r.row.id !== m.id) { // server-assigned id: retarget later edits of the temp id
            for (const x of this.q) if (x.type === m.type && x.id === m.id) { x.id = r.row.id; x.baseVersion = r.row.version; this.o.store.applyLocal(x.type, x.id, this.local(x)); }
          }
          if (m.kind === 'delete') this.o.store.applyRemote({ op: 'delete', type: m.type, id: m.id, version: (r.row?.version ?? m.baseVersion) + 1 });
          this.settle(m);
        } else {
          if (r.kind === 'conflict' && r.row) this.o.store.applyRemote({ op: 'upsert', type: m.type, row: r.row });
          this.settle(m); // rollback: drop this mutation's optimistic fields
          this.o.onError?.(m, r);
        }
        this.changed();
      }
    } finally {
      this.running = false;
      for (const f of this.idle.splice(0)) f();
    }
  }
}

/** Views should hide entities whose delete is still pending. */
export const isPendingDelete = (e: Record<string, unknown> | null) => !!e && e[TOMB] === true;
