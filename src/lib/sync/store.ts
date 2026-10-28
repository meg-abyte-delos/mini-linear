// Normalised client cache: one table per entity type, keyed by id. Each record holds the confirmed server copy
// (`server`) and the pending optimistic field edits (`pending`); readers see server + pending. Framework-agnostic:
// React binds with useSyncExternalStore(store.subscribe, () => store.all('issue')). See docs/sync.md.
import { rebase, type Entity } from './merge';

export type Change<T extends Entity = Entity> =
  | { op: 'upsert'; type: string; row: T }
  | { op: 'delete'; type: string; id: string; version: number };

type Rec = { server: Entity | null; pending: Record<string, unknown>; view: Entity | null; conflicts: string[] };
type Listener = () => void;
const empty = (): Rec => ({ server: null, pending: {}, view: null, conflicts: [] });

export class SyncStore {
  private tables = new Map<string, Map<string, Rec>>();
  private listeners = new Set<Listener>();
  private snapshots = new Map<string, readonly Entity[]>();
  private tombstones = new Map<string, number>(); // type:id -> deleted version, drops late upserts

  subscribe = (l: Listener): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private emit(type: string) { this.snapshots.delete(type); for (const l of [...this.listeners]) l(); }
  private table(type: string) { let t = this.tables.get(type); if (!t) this.tables.set(type, (t = new Map())); return t; }

  get<T extends Entity>(type: string, id: string): T | null { return (this.table(type).get(id)?.view as T | undefined) ?? null; }
  /** Fields where a remote change was overridden by a pending local edit (UI may flag them). */
  conflicts(type: string, id: string): readonly string[] { return this.table(type).get(id)?.conflicts ?? []; }
  /** Stable array (same reference until the table changes): safe as a useSyncExternalStore snapshot. */
  all<T extends Entity>(type: string): readonly T[] {
    let s = this.snapshots.get(type);
    if (!s) { s = [...this.table(type).values()].flatMap((r) => (r.view ? [r.view] : [])); this.snapshots.set(type, s); }
    return s as readonly T[];
  }
  /** Confirmed server copy only (what a rollback returns to). */
  confirmed<T extends Entity>(type: string, id: string): T | null { return (this.table(type).get(id)?.server as T | undefined) ?? null; }

  private recompute(r: Rec) {
    const has = Object.keys(r.pending).length > 0;
    r.view = r.server ? (has ? ({ ...r.server, ...r.pending } as Entity) : r.server) : has ? (r.pending as Entity) : null;
  }

  /** Apply a server change (initial load, mutation response, realtime event). Older versions are ignored. */
  applyRemote(c: Change) {
    const t = this.table(c.type);
    const id = c.op === 'upsert' ? c.row.id : c.id;
    const tomb = this.tombstones.get(`${c.type}:${id}`);
    const incoming = c.op === 'upsert' ? c.row.version : c.version;
    if (tomb !== undefined && incoming <= tomb) return;
    const r = t.get(id) ?? empty();
    if (r.server && incoming < r.server.version) return; // out-of-order event
    if (c.op === 'delete') { this.tombstones.set(`${c.type}:${id}`, c.version); t.delete(id); this.emit(c.type); return; }
    if (r.server && Object.keys(r.pending).length) {
      const { conflicts } = rebase(r.server, c.row, r.pending as Partial<Entity>);
      r.conflicts = [...new Set([...r.conflicts, ...(conflicts as string[])])];
    }
    r.server = c.row;
    this.recompute(r);
    t.set(id, r);
    this.emit(c.type);
  }

  /** Layer optimistic field edits (or a brand-new entity when nothing is confirmed yet). */
  applyLocal(type: string, id: string, fields: Record<string, unknown>) {
    const t = this.table(type);
    const r = t.get(id) ?? empty();
    r.pending = { ...r.pending, ...fields };
    this.recompute(r);
    t.set(id, r);
    this.emit(type);
  }

  /** Drop pending fields (after confirmation, or rollback on error). */
  clearLocal(type: string, id: string, fields: readonly string[]) {
    const t = this.table(type);
    const r = t.get(id);
    if (!r) return;
    for (const f of fields) delete r.pending[f];
    r.conflicts = r.conflicts.filter((f) => f in r.pending);
    if (!r.server && !Object.keys(r.pending).length) t.delete(id);
    else this.recompute(r);
    this.emit(type);
  }

  /** Server copies, for persistence across reloads (offline start). */
  dump(): Record<string, Entity[]> {
    const out: Record<string, Entity[]> = {};
    for (const [type, t] of this.tables) out[type] = [...t.values()].flatMap((r) => (r.server ? [r.server] : []));
    return out;
  }
  hydrate(d: Record<string, Entity[]>) { for (const [type, rows] of Object.entries(d)) for (const row of rows) this.applyRemote({ op: 'upsert', type, row }); }
}
