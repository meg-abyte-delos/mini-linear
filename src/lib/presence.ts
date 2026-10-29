'use client';
// Live presence: who is viewing which issue. usePresence(slug, issueId) heartbeats POST /w/:slug/presence {issue_id} (server TTL 30 s)
// and follows the `presence` events of the SSE feed (published by the Shell through publishPresence).
import { useEffect, useSyncExternalStore } from 'react';
import type { PresenceUser } from '@/components/PresenceStack';

export type PresenceState = { viewers: string[]; count: number };
const EMPTY: PresenceState = { viewers: [], count: 0 };
const state = new Map<string, PresenceState>();
const subs = new Set<() => void>();
let snapshot: ReadonlyMap<string, PresenceState> = new Map();
const bump = () => { snapshot = new Map(state); subs.forEach((f) => f()); };
const same = (a: PresenceState | undefined, b: PresenceState) => !!a && a.count === b.count && a.viewers.length === b.viewers.length && a.viewers.every((v, i) => v === b.viewers[i]);

/** Called with every `presence` SSE event (and with each heartbeat answer). Replaces the viewer list of that issue. */
export function publishPresence(p: { issue_id: string; viewers: string[]; count: number }): void {
  const next = { viewers: p.viewers, count: p.count };
  if (same(state.get(p.issue_id), next)) return;
  if (next.count === 0) state.delete(p.issue_id); else state.set(p.issue_id, next);
  bump();
}
export const presenceOf = (issueId: string): PresenceState => state.get(issueId) ?? EMPTY;
export const resetPresence = () => { state.clear(); bump(); };

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
      if (r.ok && !stopped) { const b = (await r.json()) as { viewers: { user_id: string }[]; count: number }; publishPresence({ issue_id: issueId, viewers: b.viewers.map((v) => v.user_id).sort(), count: b.count }); }
    } catch { /* offline: next beat retries */ }
  };
  void beat();
  const t = setInterval(() => { void beat(); }, opts.intervalMs ?? 10_000);
  return () => { stopped = true; clearInterval(t); void call('DELETE').catch(() => undefined); };
}

type FeedES = { onopen: ((e: unknown) => void) | null; addEventListener(t: string, f: (e: { data: string }) => void): void; close(): void };
let feed: { slug: string; refs: number; es: FeedES } | null = null;
/**
 * Shared, ref-counted listener on the SSE `presence` events, for pages that do not mount the Shell (issue detail page):
 * the viewer list then updates instantly instead of at the next heartbeat. Same store as the Shell feed (identical events dedupe).
 * The server sends a snapshot when a stream opens, so a reconnect clears the store first (no ghost viewers).
 */
export function subscribePresenceFeed(slug: string, mk: (url: string) => FeedES = (u) => new EventSource(u, { withCredentials: true }) as unknown as FeedES): () => void {
  if (feed && feed.slug !== slug) { feed.es.close(); feed = null; resetPresence(); }
  if (!feed) {
    const es = mk(`/api/v1/w/${slug}/events`);
    let wasLive = false;
    es.addEventListener('presence', (m) => { try { publishPresence(JSON.parse(m.data)); } catch { /* malformed frame */ } });
    es.addEventListener('resync', () => resetPresence());
    es.onopen = () => { if (wasLive) resetPresence(); wasLive = true; };
    feed = { slug, refs: 0, es };
  }
  const mine = feed; mine.refs++;
  return () => { mine.refs--; if (mine.refs <= 0) { mine.es.close(); if (feed === mine) feed = null; } };
}

/** Users (ids) currently viewing `issueId`, me included. Pass `slug = null` (mock mode) or no issue to stay idle. */
export function usePresence(slug: string | null | undefined, issueId: string | null | undefined): PresenceState {
  useEffect(() => (slug && issueId ? startHeartbeat(slug, issueId) : undefined), [slug, issueId]);
  useEffect(() => (slug && issueId && typeof EventSource !== 'undefined' ? subscribePresenceFeed(slug) : undefined), [slug, issueId]);
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => (issueId ? presenceOf(issueId) : EMPTY),
    () => EMPTY,
  );
}

/** Every issue with at least one viewer (board cards). Stable between events. */
export function usePresenceMap(): ReadonlyMap<string, PresenceState> {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snapshot, () => snapshot);
}

const HUES = ['h1', 'h2', 'h3', 'h4', 'h5'];
const initialsOf = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const hueOf = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]!; };

/** Pure: viewer ids -> PresenceStack input. Names come from `people` (members); unknown ids show as "Someone". Pass meId to hide yourself. */
export function toPresenceUsers(ids: readonly string[], people: readonly { id: string; name: string }[], meId?: string | null): PresenceUser[] {
  return ids.filter((id) => id !== meId).map((id) => {
    const name = people.find((p) => p.id === id)?.name ?? 'Someone';
    return { id, name, initials: initialsOf(name), hue: hueOf(id), active: true };
  });
}
