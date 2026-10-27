// Browser-side calls to the M2 issues API. Pure over an injectable fetch so it is unit-testable.
import type { Issue } from '@/lib/issues';

export type SyncResult =
  | { kind: 'ok'; issue: Issue }
  | { kind: 'conflict'; issue: Issue | null } // 412: caller shows the toast; `issue` is the refetched server copy
  | { kind: 'error'; issue: Issue | null };

type Fetch = typeof fetch;
const base = (slug: string) => `/api/v1/w/${slug}`;
const isUuid = (s: string | null | undefined): s is string => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export { isUuid };

function fromApi(r: Record<string, unknown>, prev?: Issue): Issue {
  return { ...(prev ?? ({ sort_key: '' } as Issue)), ...(r as unknown as Issue), sort_key: prev?.sort_key ?? '' };
}

export async function getIssue(slug: string, id: string, f: Fetch = fetch, prev?: Issue): Promise<Issue | null> {
  try {
    const res = await f(`${base(slug)}/issues/${id}`);
    return res.ok ? fromApi((await res.json()) as Record<string, unknown>, prev) : null;
  } catch { return null; }
}

/** PATCH with If-Match: "<version>". On 412 the issue is refetched once; there is no automatic retry. */
export async function patchIssue(slug: string, prev: Issue, version: number, patch: Record<string, unknown>, f: Fetch = fetch): Promise<SyncResult> {
  try {
    const res = await f(`${base(slug)}/issues/${prev.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${version}"` }, body: JSON.stringify(patch) });
    if (res.ok) return { kind: 'ok', issue: fromApi((await res.json()) as Record<string, unknown>, prev) };
    const fresh = await getIssue(slug, prev.id, f, prev);
    return { kind: res.status === 412 ? 'conflict' : 'error', issue: fresh };
  } catch { return { kind: 'error', issue: null }; }
}

export async function createIssue(slug: string, teamId: string, title: string, f: Fetch = fetch): Promise<Issue | null> {
  try {
    const res = await f(`${base(slug)}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team_id: teamId, title }) });
    return res.ok ? fromApi((await res.json()) as Record<string, unknown>) : null;
  } catch { return null; }
}
