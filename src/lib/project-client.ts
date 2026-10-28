// Browser-side calls for the project detail page (#67 endpoints). Pure over an injectable fetch so it is unit-testable.
export type Health = 'on_track' | 'at_risk' | 'off_track';
export interface ProjectDetail {
  id: string; name: string; description: string; status: string; lead_id: string | null; start_date: string | null; target_date: string | null;
  issue_count: number; done_count: number; progress_pct: number; health: Health | null; version: number;
}
export interface Milestone { id: string; name: string; description: string; target_date: string | null; sort_order: number; version: number }
export interface ProjectUpdate { id: string; author_id: string; health: Health; body: string; created_at: string }

export const HEALTH_LABEL: Record<Health, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

type Fetch = typeof fetch;
const base = (slug: string, id: string) => `/api/v1/w/${slug}/projects/${id}`;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function projectClient(slug: string, id: string, f: Fetch = fetch) {
  const post = (path: string, body: unknown) => f(`${base(slug, id)}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return {
    get: async () => json<ProjectDetail>(await f(base(slug, id))),
    milestones: async () => (await json<{ items: Milestone[] }>(await f(`${base(slug, id)}/milestones?limit=100`))).items,
    updates: async () => (await json<{ items: ProjectUpdate[] }>(await f(`${base(slug, id)}/updates?limit=100`))).items,
    patch: async (version: number, body: Partial<Pick<ProjectDetail, 'status' | 'target_date' | 'lead_id'>>) => json<ProjectDetail>(await f(base(slug, id), { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${version}"` }, body: JSON.stringify(body) })),
    addUpdate: async (health: Health, body: string) => json<ProjectUpdate>(await post('/updates', { health, body })),
    addMilestone: async (name: string, target_date: string | null) => json<Milestone>(await post('/milestones', { name, description: '', target_date, sort_order: 0 })),
  };
}

/** Updates are listed oldest first by the API (id order): show the newest first. */
export const newestFirst = (u: ProjectUpdate[]): ProjectUpdate[] => [...u].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
export const byTarget = (m: Milestone[]): Milestone[] => [...m].sort((a, b) => (a.target_date ?? '9999') < (b.target_date ?? '9999') ? -1 : (a.target_date ?? '9999') > (b.target_date ?? '9999') ? 1 : a.sort_order - b.sort_order);

export const PROJECT_STATUSES = ['backlog', 'planned', 'in_progress', 'paused', 'completed', 'canceled'] as const;
export const statusLabel = (s: string): string => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
