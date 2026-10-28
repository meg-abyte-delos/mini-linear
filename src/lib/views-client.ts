// Saved views data access behind one interface: HTTP (API mode) or in-memory (mock mode, used by the e2e suite).
import { FILTER_KEYS, emptyFilters, type FilterKey, type Filters } from '@/lib/filters';

export interface SavedView {
  id: string; owner_id?: string; team_id: string | null; name: string; shared: boolean; layout: 'list' | 'board';
  filters: { op: 'and' | 'or'; rules: unknown[] }; version: number;
}
export interface NewView { name: string; shared: boolean; layout: 'list' | 'board'; filters: Filters }
export interface ViewsClient {
  list(): Promise<SavedView[]>;
  create(v: NewView): Promise<SavedView | null>;
  remove(v: SavedView): Promise<boolean>;
}

/** One `in` rule per non-empty dimension (AND across dimensions, OR within one: same semantics as applyFilters). */
export const filtersToGroup = (f: Filters): SavedView['filters'] => ({
  op: 'and',
  rules: FILTER_KEYS.filter((k) => f[k].length > 0).map((k) => ({ field: k, op: 'in', value: f[k] })),
});

/** Inverse of filtersToGroup. Rules it does not understand are ignored (a view written by another client still opens). */
export function groupToFilters(g: SavedView['filters'] | null | undefined): Filters {
  const f = emptyFilters();
  for (const r of g?.rules ?? []) {
    const x = r as { field?: string; op?: string; value?: unknown };
    if (!x || x.op !== 'in' || !(FILTER_KEYS as readonly string[]).includes(x.field ?? '') || !Array.isArray(x.value)) continue;
    f[x.field as FilterKey] = x.value.filter((v): v is string => typeof v === 'string');
  }
  return f;
}

/** Shareable URL: the view id (opens the saved view for anyone who can see it). */
export const viewUrl = (origin: string, path: string, id: string) => `${origin}${path}?v=${id}`;

export function httpViewsClient(slug: string, f: typeof fetch = fetch): ViewsClient {
  const b = `/api/v1/w/${slug}/views`;
  return {
    async list() {
      try { const r = await f(`${b}?limit=100`); return r.ok ? ((await r.json()) as { items: SavedView[] }).items : []; } catch { return []; }
    },
    async create(v) {
      try {
        const r = await f(b, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: v.name, shared: v.shared, layout: v.layout, filters: filtersToGroup(v.filters) }) });
        return r.ok ? ((await r.json()) as SavedView) : null;
      } catch { return null; }
    },
    async remove(v) {
      try { return (await f(`${b}/${v.id}`, { method: 'DELETE', headers: { 'if-match': `"${v.version}"` } })).ok; } catch { return false; }
    },
  };
}

export function mockViewsClient(seed: SavedView[] = []): ViewsClient {
  let rows = [...seed], n = 0;
  return {
    async list() { return [...rows]; },
    async create(v) {
      const row: SavedView = { id: `mv${++n}`, team_id: null, name: v.name, shared: v.shared, layout: v.layout, filters: filtersToGroup(v.filters), version: 1 };
      rows = [...rows, row]; return row;
    },
    async remove(v) { rows = rows.filter((r) => r.id !== v.id); return true; },
  };
}
