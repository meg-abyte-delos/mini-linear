// Browser-side client for the issue-detail endpoints of the Area 1 contract. Endpoints that are not on main yet answer
// 404/405: the client reports `unsupported` and the UI keeps working on local state (feature detection, no crash).
export type Res<T> = { ok: true; data: T } | { ok: false; unsupported: boolean; status: number };
type Fetch = typeof fetch;
const base = (slug: string) => `/api/v1/w/${encodeURIComponent(slug)}`;

export async function call<T>(f: Fetch, url: string, init?: RequestInit): Promise<Res<T>> {
  try {
    const res = await f(url, init && init.body ? { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } } : init);
    if (res.ok) return { ok: true, data: (res.status === 204 ? null : await res.json()) as T };
    return { ok: false, unsupported: res.status === 404 || res.status === 405 || res.status === 501, status: res.status };
  } catch { return { ok: false, unsupported: false, status: 0 }; }
}

export interface Relation { id: string; type: 'blocks' | 'blocked_by' | 'related' | 'duplicate'; issue_id: string; related_issue_id: string; direction?: 'outgoing' | 'incoming' }
export interface Attachment { id: string; kind: 'link' | 'file'; url: string; title: string; created_by: string | null }
export interface Comment { id: string; body: string; author_id: string | null; parent_comment_id: string | null; created_at: string; version?: number; edited_at?: string | null; reactions?: Reaction[] }
/** Server shape (#75): user_ids of reactors; `mine` is derived client-side from the viewer id. */
export interface Reaction { emoji: string; count: number; user_ids?: string[] }
export const reactedBy = (r: Reaction | undefined, me: string) => !!r?.user_ids?.includes(me);
/** Server shape (#68): actor_id + human summary + per-field changes (description/body values are redacted to null). */
export interface ActivityItem { id: string; actor_id: string | null; action: string; summary?: string; changes?: { field: string; label: string; before: unknown; after: unknown; text: string }[]; created_at: string }
type Page<T> = { items: T[]; next_cursor: string | null };

export function detailApi(slug: string, f: Fetch = (...a) => fetch(...a)) {
  const b = base(slug);
  const j = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    relations: (id: string) => call<Page<Relation>>(f, `${b}/issues/${id}/relations`),
    addRelation: (id: string, type: Relation['type'], related_issue_id: string) => call<Relation>(f, `${b}/issues/${id}/relations`, j('POST', { type, related_issue_id })),
    removeRelation: (id: string, rid: string) => call<null>(f, `${b}/issues/${id}/relations/${rid}`, j('DELETE')),
    attachments: (id: string) => call<Page<Attachment>>(f, `${b}/issues/${id}/attachments`),
    addAttachment: (id: string, a: { kind: 'link'; url: string; title: string }) => call<Attachment>(f, `${b}/issues/${id}/attachments`, j('POST', a)),
    removeAttachment: (id: string, aid: string) => call<null>(f, `${b}/issues/${id}/attachments/${aid}`, j('DELETE')),
    activity: (id: string, cursor?: string) => call<Page<ActivityItem>>(f, `${b}/issues/${id}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    comments: (id: string) => call<Page<Comment>>(f, `${b}/issues/${id}/comments`),
    addComment: (id: string, body: string, parent_comment_id: string | null) => call<Comment>(f, `${b}/issues/${id}/comments`, j('POST', { body, parent_comment_id })),
    editComment: (cid: string, body: string, version: number) => call<Comment>(f, `${b}/comments/${cid}`, { ...j('PATCH', { body }), headers: { 'if-match': `"${version}"` } }),
    deleteComment: (cid: string, version: number) => call<null>(f, `${b}/comments/${cid}`, { method: 'DELETE', headers: { 'if-match': `"${version}"` } }),
    react: (cid: string, emoji: string, on: boolean) => call<null>(f, `${b}/comments/${cid}/reactions`, j(on ? 'POST' : 'DELETE', { emoji })),
    archive: (id: string, on: boolean) => call<unknown>(f, `${b}/issues/${id}/${on ? 'archive' : 'unarchive'}`, j('POST')),
    remove: (id: string) => call<null>(f, `${b}/issues/${id}`, j('DELETE')),
    restore: (id: string) => call<unknown>(f, `${b}/issues/${id}/restore`, j('POST')),
  };
}
