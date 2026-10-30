// Presence protocol, client side: the store the SSE `presence` events land in. State and events only, no hooks and no UI:
// the UI side is usePresence/buildPresence (src/lib/presence/), which listens here for instant updates between heartbeats.
export type PresenceEvent = { issue_id: string; viewers: string[]; count: number };
const state = new Map<string, PresenceEvent>();
const listeners = new Set<(p: PresenceEvent) => void>();

/** Called with every `presence` SSE event: replaces the viewer list of that issue and notifies listeners. */
export function publishPresence(p: PresenceEvent): void {
  if (p.count === 0) state.delete(p.issue_id); else state.set(p.issue_id, p);
  listeners.forEach((f) => f(p));
}
export const presenceOf = (issueId: string): { viewers: string[]; count: number } => {
  const p = state.get(issueId);
  return p ? { viewers: p.viewers, count: p.count } : { viewers: [], count: 0 };
};
/** Reconnect / resync / workspace change: drop everything, the server sends a fresh snapshot when a stream opens. Listeners keep their last list until the next event or heartbeat. */
export const resetPresence = (): void => { state.clear(); };
/** Listen to presence events (not to resets). Returns unsubscribe. */
export function onPresenceEvent(f: (p: PresenceEvent) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
