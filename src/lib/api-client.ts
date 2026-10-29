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

// PATCHes of one issue are serialized. Two edits in quick succession (estimate, then due date) would otherwise both go out with the
// same If-Match: the second gets a 412, and the caller replaces its optimistic state with the server row, which lacks the new value.
const patchChain = new Map<string, Promise<unknown>>();
const knownVersion = new Map<string, number>();

/** PATCH with If-Match: "<version>". On 412 the issue is refetched once; there is no automatic retry. */
export async function patchIssue(slug: string, prev: Issue, version: number, patch: Record<string, unknown>, f: Fetch = fetch): Promise<SyncResult> {
  const run = (patchChain.get(prev.id) ?? Promise.resolve()).then(() => send(slug, prev, version, patch, f));
  patchChain.set(prev.id, run.catch(() => undefined));
  return run;
}

async function send(slug: string, prev: Issue, version: number, patch: Record<string, unknown>, f: Fetch): Promise<SyncResult> {
  // Versions only grow: when an earlier PATCH of this issue succeeded while this one was queued, use its resulting version.
  const v = Math.max(version, knownVersion.get(prev.id) ?? 0);
  try {
    const res = await f(`${base(slug)}/issues/${prev.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${v}"` }, body: JSON.stringify(patch) });
    if (res.ok) {
      const issue = fromApi((await res.json()) as Record<string, unknown>, prev);
      knownVersion.set(prev.id, issue.version);
      return { kind: 'ok', issue };
    }
    const fresh = await getIssue(slug, prev.id, f, prev);
    if (fresh) knownVersion.set(prev.id, fresh.version);
    return { kind: res.status === 412 ? 'conflict' : 'error', issue: fresh };
  } catch { return { kind: 'error', issue: null }; }
}

export async function createIssue(slug: string, teamId: string, title: string, f: Fetch = fetch, parentId?: string): Promise<Issue | null> {
  try {
    const res = await f(`${base(slug)}/issues`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parentId ? { team_id: teamId, title, parent_id: parentId } : { team_id: teamId, title }) });
    return res.ok ? fromApi((await res.json()) as Record<string, unknown>) : null;
  } catch { return null; }
}

export interface BulkResult { succeeded: string[]; failed: { id: string; code: string; message: string }[] }

/** POST /issues/bulk (max 250 ids per call; the caller chunks). A transport or HTTP error fails every id. */
export async function bulkPatch(slug: string, ids: string[], patch: Record<string, unknown>, f: Fetch = fetch): Promise<BulkResult> {
  const failAll = (message: string): BulkResult => ({ succeeded: [], failed: ids.map((id) => ({ id, code: 'error', message })) });
  try {
    const res = await f(`${base(slug)}/issues/bulk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, patch }) });
    if (!res.ok) return failAll(`HTTP ${res.status}`);
    const j = (await res.json()) as Partial<BulkResult>;
    return { succeeded: j.succeeded ?? [], failed: j.failed ?? [] };
  } catch { return failAll('network error'); }
}
