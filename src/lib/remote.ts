// API mode (ML_API=1): server-side loader that calls the M2 handlers in-process, plus config. Mock mode stays the default.
// Assumptions (Meg, 2026-10-27): workspace slug and team id come from env until M1's /w/[slug]; USERS stay mocked;
// only status changes go through the API (order stays client-side).
import { listIssues } from '@/lib/issues/handlers';
import { listLabels, listCycles } from '@/lib/resources/labels-cycles';
import { listProjects } from '@/lib/resources/projects-comments';
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
async function all<T>(h: (req: Request, slug: string) => Promise<Response>, slug: string, path: string): Promise<T[]> {
  installDevAuth();
  const out: T[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < 100; n++) { // hard cap: 10k rows
    const url = `http://localhost/api/v1/w/${slug}/${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await h(new Request(url), slug);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    const body = (await res.json()) as Page<T>;
    out.push(...body.items);
    if (!body.next_cursor) return out;
    cursor = body.next_cursor;
  }
  return out;
}

type ApiIssue = Omit<Issue, 'sort_key'> & { identifier: string };
export function toIssue(r: ApiIssue, i = 0): Issue {
  return { ...r, sort_key: String(i).padStart(8, '0'), created_at: r.created_at };
}
// Guests get 403 on labels/cycles/projects: treat as empty lookups instead of failing the page.
const soft = async <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

export async function loadRemote(cfg: ApiConfig): Promise<{ issues: Issue[]; meta: Meta }> {
  const [issues, labels, cycles, projects] = await Promise.all([
    all<ApiIssue>(listIssues, cfg.slug, 'issues'),
    soft(all<{ id: string; name: string }>(listLabels, cfg.slug, 'labels')),
    soft(all<Meta['cycles'][number]>(listCycles, cfg.slug, 'cycles')),
    soft(all<Meta['projects'][number]>(listProjects, cfg.slug, 'projects')),
  ]);
  return {
    issues: issues.map(toIssue),
    meta: {
      // The API label has a hex color; chips use 3 theme hues for now (TODO: render the hex once the theme allows inline colors).
      labels: labels.map((l, n) => ({ id: l.id, name: l.name, hue: `lb${(n % 3) + 1}` })),
      cycles: cycles.filter((c) => c.team_id === cfg.teamId),
      projects,
    },
  };
}
