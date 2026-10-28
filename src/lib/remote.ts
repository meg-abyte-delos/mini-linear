// API mode (ML_API=1): server-side loader that calls the M2 handlers in-process, plus config. Mock mode stays the default.
// Assumptions (Meg, 2026-10-27): workspace slug and team id come from env until M1's /w/[slug]; USERS stay mocked;
// only status changes go through the API (order stays client-side).
import { listIssues } from '@/lib/issues/handlers';
import { listLabels, listCycles } from '@/lib/resources/labels-cycles';
import { listProjects } from '@/lib/resources/projects-comments';
import { getWorkspace } from '@/lib/resources/tenancy';
import { installDevAuth } from '@/lib/dev-auth';
import type { Issue, Meta } from '@/lib/issues';

export type ApiConfig = { slug: string; teamId: string };
export function apiConfig(): ApiConfig | null {
  if (process.env.ML_API !== '1') return null;
  const slug = process.env.ML_WORKSPACE_SLUG, teamId = process.env.ML_TEAM_ID;
  if (!slug || !teamId) throw new Error('ML_API=1 needs ML_WORKSPACE_SLUG and ML_TEAM_ID');
  return { slug, teamId };
}

type Page<T> = { items: T[]; next_cursor: string | null };
export class HttpError extends Error { constructor(msg: string, readonly status: number) { super(msg); } }
export const PAGE_CAP = 100; // pages of 100 rows -> 10k rows
type All<T> = { items: T[]; truncated: boolean };
async function all<T>(h: (req: Request, slug: string) => Promise<Response>, slug: string, path: string): Promise<All<T>> {
  installDevAuth();
  const out: T[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < PAGE_CAP; n++) { // hard cap: 10k rows
    const url = `http://localhost/api/v1/w/${slug}/${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await h(new Request(url), slug);
    if (!res.ok) throw new HttpError(`${path} -> ${res.status}`, res.status);
    const body = (await res.json()) as Page<T>;
    out.push(...body.items);
    if (!body.next_cursor) return { items: out, truncated: false };
    cursor = body.next_cursor;
  }
  return { items: out, truncated: true };
}

type ApiIssue = Omit<Issue, 'sort_key'> & { identifier: string };
export function toIssue(r: ApiIssue, i = 0): Issue {
  return { ...r, sort_key: String(i).padStart(8, '0'), created_at: r.created_at };
}
// Guests get 403 on labels/cycles/projects: only that is an empty lookup. Anything else (500, network) fails the page.
const soft = async <T,>(p: Promise<All<T>>): Promise<All<T>> => p.catch((e) => { if (e instanceof HttpError && e.status === 403) return { items: [], truncated: false }; throw e; });

export async function loadRemote(cfg: ApiConfig): Promise<{ issues: Issue[]; meta: Meta; truncated: boolean }> {
  const [iss, lab, cyc, prj] = await Promise.all([
    all<ApiIssue>(listIssues, cfg.slug, 'issues'),
    soft(all<{ id: string; name: string; team_id?: string | null }>(listLabels, cfg.slug, 'labels')),
    soft(all<Meta['cycles'][number]>(listCycles, cfg.slug, 'cycles')),
    soft(all<Meta['projects'][number]>(listProjects, cfg.slug, 'projects')),
  ]);
  const issues = iss.items, labels = lab.items, cycles = cyc.items, projects = prj.items;
  return {
    truncated: iss.truncated,
    issues: issues.map(toIssue),
    meta: {
      // The API label has a hex color; chips use 3 theme hues for now (TODO: render the hex once the theme allows inline colors).
      // Pickers offer workspace labels and the labels of the current team only; scope is shown as a badge.
      labels: labels.filter((l) => !l.team_id || l.team_id === cfg.teamId).map((l, n) => ({ id: l.id, name: l.name, hue: `lb${(n % 3) + 1}`, scope: (l.team_id ? 'team' : 'workspace') as 'team' | 'workspace' })),
      cycles: cycles.filter((c) => c.team_id === cfg.teamId),
      projects,
    },
  };
}

/** Session role in the workspace, from the same handler as GET /w/:slug. Fails closed: anything unknown is a guest (read-only). */
export type WsRole = 'owner' | 'admin' | 'member' | 'guest';
export async function loadRole(cfg: ApiConfig): Promise<WsRole> {
  installDevAuth();
  try {
    const res = await getWorkspace(new Request(`http://localhost/api/v1/w/${cfg.slug}`), cfg.slug);
    if (!res.ok) return 'guest';
    const r = (await res.json()) as { role?: string };
    return r.role === 'owner' || r.role === 'admin' || r.role === 'member' ? r.role : 'guest';
  } catch { return 'guest'; }
}
