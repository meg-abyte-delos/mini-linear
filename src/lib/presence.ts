'use client';
// Live presence: who is viewing which issue. usePresence(slug, issueId) heartbeats POST /w/:slug/presence {issue_id} (server TTL 30 s)
// and follows the `presence` events of the SSE feed (published by the Shell through publishPresence).
import { useEffect, useSyncExternalStore } from 'react';

export type PresenceState = { viewers: string[]; count: number };
const EMPTY: PresenceState = { viewers: [], count: 0 };
const state = new Map<string, PresenceState>();
const subs = new Set<() => void>();
const same = (a: PresenceState | undefined, b: PresenceState) => !!a && a.count === b.count && a.viewers.length === b.viewers.length && a.viewers.every((v, i) => v === b.viewers[i]);

/** Called with every `presence` SSE event (and with each heartbeat answer). Replaces the viewer list of that issue. */
export function publishPresence(p: { issue_id: string; viewers: string[]; count: number }): void {
  const next = { viewers: p.viewers, count: p.count };
  if (same(state.get(p.issue_id), next)) return;
  if (next.count === 0) state.delete(p.issue_id); else state.set(p.issue_id, next);
  subs.forEach((f) => f());
}
export const presenceOf = (issueId: string): PresenceState => state.get(issueId) ?? EMPTY;
export const resetPresence = () => { state.clear(); subs.forEach((f) => f()); };

type Opts = { intervalMs?: number; fetch?: typeof fetch };
/** Heartbeat loop for one issue. Returns stop(), which also tells the server we left. */
export function startHeartbeat(slug: string, issueId: string, opts: Opts = {}): () => void {
  const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const url = `/api/v1/w/${slug}/presence`;
  const call = (method: 'POST' | 'DELETE') => f(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issue_id: issueId }) });
  let stopped = false;
  const beat = async () => {
    try {
      const r = await call('POST');
      if (r.ok && !stopped) { const b = (await r.json()) as { viewers: { user_id: string }[]; count: number }; publishPresence({ issue_id: issueId, viewers: b.viewers.map((v) => v.user_id), count: b.count }); }
    } catch { /* offline: next beat retries */ }
  };
  void beat();
  const t = setInterval(() => { void beat(); }, opts.intervalMs ?? 10_000);
  return () => { stopped = true; clearInterval(t); void call('DELETE').catch(() => undefined); };
}

/** Users (ids) currently viewing `issueId`, me included. Pass `slug = null` (mock mode) or no issue to stay idle. */
export function usePresence(slug: string | null | undefined, issueId: string | null | undefined): PresenceState {
  useEffect(() => (slug && issueId ? startHeartbeat(slug, issueId) : undefined), [slug, issueId]);
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => (issueId ? presenceOf(issueId) : EMPTY),
    () => EMPTY,
  );
}
