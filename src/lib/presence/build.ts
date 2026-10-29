// Pure mapping from the presence API rows to PresenceUser (unit-tested).
import { hueFor, initialsOf } from '@/lib/member-hue';
import type { PresenceUser } from '@/components/PresenceStack';

export interface ViewerRow { user_id: string; seen_at: string }
/** A viewer whose last heartbeat is older than this is shown idle (still inside the 30s server TTL). */
export const IDLE_AFTER_MS = 15_000;

export function buildPresence(rows: readonly ViewerRow[], people: readonly { id: string; name: string }[], now: number, me?: string | null): PresenceUser[] {
  const seen = new Set<string>();
  const out: PresenceUser[] = [];
  for (const r of rows) {
    if (seen.has(r.user_id) || r.user_id === me) continue;
    seen.add(r.user_id);
    const name = people.find((p) => p.id === r.user_id)?.name ?? 'Unknown member';
    out.push({ id: r.user_id, name, initials: initialsOf(name), hue: hueFor(r.user_id), active: now - Date.parse(r.seen_at) < IDLE_AFTER_MS });
  }
  // Active first, then most recent heartbeat (rows already arrive newest first).
  return out.sort((a, b) => Number(b.active) - Number(a.active));
}
