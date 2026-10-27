import type { Issue, Status } from '@/lib/issues';

/**
 * Pure move: returns a new array (or the same reference when nothing changes).
 * - beforeId set and found: insert before that issue, taking the target's status is the caller's job (pass it as `status`).
 * - beforeId null or not found: append after the last issue of `status` (end of the array if the column is empty).
 * - id missing, or dropped on itself: no-op.
 */
export function moveIssue(all: readonly Issue[], id: string, status: Status, beforeId: string | null): readonly Issue[] {
  const src = all.find((i) => i.id === id);
  if (!src || id === beforeId) return all;
  const moved = src.status === status ? src : { ...src, status, version: src.version + 1 };
  const rest = all.filter((i) => i.id !== id);
  const at = beforeId ? rest.findIndex((i) => i.id === beforeId) : -1;
  if (at < 0) {
    const last = rest.map((i) => i.status).lastIndexOf(status);
    rest.splice(last < 0 ? rest.length : last + 1, 0, moved);
  } else rest.splice(at, 0, moved);
  return rest;
}
