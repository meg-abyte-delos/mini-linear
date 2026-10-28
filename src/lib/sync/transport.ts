// HTTP transport for the mutation queue over the v1 REST API (If-Match versions, 412 on stale).
import type { Entity } from './merge';
import type { Mutation, SendResult, Transport } from './queue';

type Fetch = typeof fetch;
const PATHS: Record<string, string> = { issue: 'issues', comment: 'comments' };
const retryable = (s: number) => s >= 500 || s === 429 || s === 408;

export function httpTransport(slug: string, f: Fetch = (...a) => fetch(...a)): Transport {
  const base = `/api/v1/w/${slug}`;
  const refetch = async (m: Mutation): Promise<Entity | null> => {
    try { const r = await f(`${base}/${PATHS[m.type]}/${m.id}`); return r.ok ? ((await r.json()) as Entity) : null; } catch { return null; }
  };
  return async (m): Promise<SendResult> => {
    const path = PATHS[m.type];
    if (!path) return { kind: 'rejected', status: 0, message: `unknown entity ${m.type}` };
    let res: Response;
    try {
      if (m.kind === 'create') {
        const url = m.type === 'comment' ? `${base}/issues/${String(m.fields.issue_id)}/comments` : `${base}/${path}`;
        const body = Object.fromEntries(Object.entries(m.fields).filter(([k]) => k !== 'issue_id'));
        res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m.type === 'comment' ? body : m.fields) });
      } else {
        res = await f(`${base}/${path}/${m.id}`, { method: m.kind === 'delete' ? 'DELETE' : 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${m.baseVersion}"` }, body: m.kind === 'delete' ? undefined : JSON.stringify(m.fields) });
      }
    } catch { return { kind: 'offline' }; }
    if (res.ok) return { kind: 'ok', row: res.status === 204 ? null : ((await res.json().catch(() => null)) as Entity | null) };
    if (res.status === 412) return { kind: 'conflict', row: await refetch(m) };
    if (retryable(res.status)) return { kind: 'offline' };
    let message: string | undefined;
    try { message = ((await res.json()) as { error?: { message?: string } }).error?.message; } catch { /* no body */ }
    return { kind: 'rejected', status: res.status, message };
  };
}
