// Field-level three-way merge for last-write-wins with local intent preserved.
// base = server copy the local edit was made against, remote = newest server copy, pending = local unconfirmed fields.
// A field the user touched locally keeps the local value; every other field takes the remote value.
export type Entity = { id: string; version: number } & Record<string, unknown>;

export const eq = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  return false;
};

export type MergeResult<T> = { merged: T; conflicts: (keyof T)[] };

/**
 * Rebase pending local field edits onto a newer remote copy. A conflict is a pending field the remote ALSO changed
 * since base to a different value: local wins (this client writes last, it will PATCH after) but the field is reported
 * so the UI can flag it. Fields only the remote changed are taken from the remote: no lost updates on other fields.
 */
export function rebase<T extends Entity>(base: T, remote: T, pending: Partial<T>): MergeResult<T> {
  const merged = { ...remote } as T;
  const conflicts: (keyof T)[] = [];
  for (const k of Object.keys(pending) as (keyof T)[]) {
    if (k === 'id' || k === 'version') continue;
    if (!eq(base[k], remote[k]) && !eq(remote[k], pending[k])) conflicts.push(k);
    merged[k] = pending[k] as T[keyof T];
  }
  return { merged, conflicts };
}
