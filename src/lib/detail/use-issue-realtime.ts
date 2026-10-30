'use client';
// Live updates for the standalone issue page: subscribes to the workspace SSE feed (same bridge as the Shell) and routes
// events to callbacks. Own writes are skipped by version; callbacks are read through a ref so the stream never reconnects
// on re-render.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { fetchAllIssues, startIssueRealtime } from '@/lib/realtime-bridge';
import type { ConnState } from '@/lib/sync/realtime';
import type { Issue } from '@/lib/issues';

export type IssueRealtimeHandlers = {
  /** The viewed issue changed elsewhere (newer than the known version). */
  onSelf: (row: Issue) => void;
  /** The viewed issue was deleted elsewhere. */
  onSelfGone: () => void;
  /** Another issue changed (parent / sub-issue lists). */
  onOther: (row: Issue) => void;
  onOtherGone: (id: string) => void;
  /** Any issue or comment event, reconnect or resync: refetch comments, activity, relations. */
  onActivity: () => void;
  onState?: (s: ConnState) => void;
};

/** True only when GET /issues/:id answers 404. Network errors, 5xx and 403 are not deletions. */
export async function isGone(slug: string, issueId: string, f: typeof fetch = fetch): Promise<boolean> {
  try { return (await f(`/api/v1/w/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}`, { credentials: 'same-origin' })).status === 404; }
  catch { return false; }
}

export function useIssueRealtime(slug: string, enabled: boolean, issueId: string, version: MutableRefObject<number>, h: IssueRealtimeHandlers) {
  const hr = useRef(h); hr.current = h;
  useEffect(() => {
    if (!enabled) return;
    return startIssueRealtime({
      slug,
      known: (id) => (id === issueId ? version.current : undefined),
      upsert: (row) => { if (row.id === issueId) { if (row.version > version.current) hr.current.onSelf(row); } else hr.current.onOther(row); },
      remove: (id) => { if (id === issueId) hr.current.onSelfGone(); else hr.current.onOtherGone(id); },
      resync: async () => {
        const rows = await fetchAllIssues(slug);
        for (const r of rows) { if (r.id === issueId) { if (r.version > version.current) hr.current.onSelf(r); } else hr.current.onOther(r); }
        // The list is capped and can fail or truncate, so absence proves nothing: only a confirmed 404 on the issue itself means it is gone.
        if (!rows.some((r) => r.id === issueId) && (await isGone(slug, issueId))) hr.current.onSelfGone();
      },
      onActivity: () => hr.current.onActivity(),
      onState: (s) => hr.current.onState?.(s),
    });
  }, [slug, enabled, issueId, version]);
}
