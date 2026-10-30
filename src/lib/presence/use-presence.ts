'use client';
import { useEffect, useState } from 'react';
import { fetchNlPeople } from '@/lib/nl-people';
import type { PresenceUser } from '@/components/PresenceStack';
import { buildPresence, type ViewerRow } from './build';
import { onPresenceEvent } from '@/lib/presence';

const BEAT_MS = 10_000;

/** Heartbeat + poll of GET/POST /w/:slug/issues/:id/presence; DELETE on leave; follows SSE presence events when the feed is open. Off when `enabled` is false (mock mode). */
export function usePresence(slug: string, issueId: string, me: string | null | undefined, enabled: boolean): PresenceUser[] {
  const [list, setList] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const url = `/api/v1/w/${encodeURIComponent(slug)}/issues/${encodeURIComponent(issueId)}/presence`;
    let people: { id: string; name: string }[] = [];
    const beat = async () => {
      try {
        const r = await fetch(url, { method: 'POST' });
        if (!r.ok || !live) return;
        const body = (await r.json()) as { viewers: ViewerRow[] };
        setList(buildPresence(body.viewers, people, Date.now(), me));
      } catch { /* offline: keep last known stack */ }
    };
    void fetchNlPeople(slug).then((p) => { people = p.users; }).catch(() => {}).finally(() => void beat());
    const t = setInterval(() => void beat(), BEAT_MS);
    // SSE `presence` events (Shell feed, see lib/presence.ts): update between heartbeats. A heartbeat answer stays the source of truth.
    const off = onPresenceEvent((p) => {
      if (!live || p.issue_id !== issueId) return;
      const at = new Date().toISOString();
      setList(buildPresence(p.viewers.map((user_id) => ({ user_id, seen_at: at })), people, Date.now(), me));
    });
    return () => { live = false; clearInterval(t); off(); void fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {}); };
  }, [slug, issueId, me, enabled]);
  return list;
}
