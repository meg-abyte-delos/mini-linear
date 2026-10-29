// The ONE place that decides which workspace/team a page shows. Reads the session from the request cookie.
// No session -> redirect to /login (never a silent fallback). `demo` is only a preference among the workspaces the
// signed-in user already belongs to. When M1's getSessionContext() (#117 follow-up) lands, only this file changes.
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { listWorkspaces, listTeams } from '@/lib/resources/tenancy';
import { installDevAuth } from '@/lib/dev-auth';
import { HttpError, type ApiConfig } from '@/lib/remote';

export const DEFAULT_WORKSPACE_SLUG = 'demo';

type Item = { slug: string; id: string };
/** Pure choice: preferred slug when the user is a member, else the first workspace. */
export const pickWorkspace = (items: Item[], preferred = DEFAULT_WORKSPACE_SLUG): Item | null => items.find((w) => w.slug === preferred) ?? items[0] ?? null;

async function get<T>(h: (req: Request, ...a: string[]) => Promise<Response>, path: string, ...args: string[]): Promise<T[]> {
  installDevAuth();
  let cookie = '';
  try { cookie = (await cookies()).toString(); } catch { /* outside a request scope */ }
  const res = await h(new Request(`http://localhost${path}`, { headers: { cookie } }), ...args);
  if (!res.ok) throw new HttpError(`${path} -> ${res.status}`, res.status);
  return ((await res.json()) as { items: T[] }).items;
}

/** Slug + first team of the signed-in user. Redirects to /login when there is no valid session. */
export async function getWorkspaceContext(): Promise<ApiConfig> {
  try {
    const ws = pickWorkspace(await get<Item>(listWorkspaces, '/api/v1/workspaces'));
    if (!ws) throw new HttpError('no workspace for this user', 404);
    const teams = await get<{ id: string }>(listTeams as never, `/api/v1/w/${ws.slug}/teams`, ws.slug);
    if (!teams[0]) throw new HttpError('no team in workspace', 404);
    return { slug: ws.slug, teamId: teams[0].id };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/login');
    throw e;
  }
}
