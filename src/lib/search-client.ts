// Browser-side client for GET /api/v1/w/:slug/search (Area 8) plus the mock-mode local equivalent. Pure over an injectable fetch.
import type { Issue } from '@/lib/issues';

export type HitKind = 'issue' | 'comment' | 'project';
export interface SearchHit {
  kind: HitKind; id: string; issue_id: string | null; identifier: string | null; title: string; snippet: string; rank: number;
  status: string | null; team_id: string | null; project_id: string | null; assignee_id: string | null;
}
export interface SearchPage { items: SearchHit[]; next_cursor: string | null }
export interface SearchOpts { kind?: HitKind; limit?: number; cursor?: string | null; signal?: AbortSignal }

/** Queries shorter than this are not sent (the server drops 1-char prefixes anyway). */
export const MIN_QUERY = 2;

export async function searchApi(slug: string, q: string, o: SearchOpts = {}, f: typeof fetch = fetch): Promise<SearchPage | null> {
  const sp = new URLSearchParams({ q: q.trim() });
  if (o.kind) sp.set('kind', o.kind);
  if (o.limit) sp.set('limit', String(o.limit));
  if (o.cursor) sp.set('cursor', o.cursor);
  try {
    const res = await f(`/api/v1/w/${slug}/search?${sp}`, { signal: o.signal });
    if (!res.ok) return null;
    const b = (await res.json()) as SearchPage;
    return { items: b.items ?? [], next_cursor: b.next_cursor ?? null };
  } catch { return null; }
}

/** Mock mode: case-insensitive substring match on identifier / title / description, title hits first. */
export function searchLocal(issues: Issue[], q: string, kind?: HitKind, limit = 8): SearchPage {
  const needle = q.trim().toLowerCase();
  if (needle.length < MIN_QUERY || kind === 'comment' || kind === 'project') return { items: [], next_cursor: null };
  const scored: { i: Issue; s: number }[] = [];
  for (const i of issues) {
    const ident = (i.identifier ?? i.id).toLowerCase();
    const s = ident === needle ? 0 : ident.includes(needle) || i.title.toLowerCase().includes(needle) ? 1 : (i.description ?? '').toLowerCase().includes(needle) ? 2 : -1;
    if (s >= 0) scored.push({ i, s });
  }
  scored.sort((a, b) => a.s - b.s);
  const items = scored.slice(0, limit).map(({ i, s }): SearchHit => ({
    kind: 'issue', id: i.id, issue_id: i.id, identifier: i.identifier ?? i.id, title: i.title, snippet: i.title, rank: 3 - s,
    status: i.status, team_id: null, project_id: null, assignee_id: null,
  }));
  return { items, next_cursor: null };
}

/** A snippet from the server carries <mark>..</mark>; turn it into segments so React renders it without innerHTML. */
export function snippetParts(s: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  for (const [idx, chunk] of s.split(/<mark>|<\/mark>/).entries()) if (chunk) out.push({ text: chunk, mark: idx % 2 === 1 });
  return out;
}

export const looksLikeIdentifier = (q: string) => /^[A-Za-z]{2,5}-\d+$/.test(q.trim());
