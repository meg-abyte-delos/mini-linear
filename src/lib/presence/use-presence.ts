'use client';
import { useEffect, useState } from 'react';
import { fetchNlPeople } from '@/lib/nl-people';
import type { PresenceUser } from '@/components/PresenceStack';
import { buildPresence, type ViewerRow } from './build';

const BEAT_MS = 10_000;

/** Heartbeat + poll of GET/POST /w/:slug/issues/:id/presence; DELETE on leave. Off when `enabled` is false (mock mode). */
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
    return () => { live = false; clearInterval(t); void fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {}); };
  }, [slug, issueId, me, enabled]);
  return list;
}
