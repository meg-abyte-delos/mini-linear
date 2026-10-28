// Pure helpers for list bulk-edit + undo. The wire shape is POST /issues/bulk (#66): { ids, patch }.
import type { Issue, Status } from '@/lib/issues';

export interface BulkPatch {
  status?: Status; priority?: number; assignee_id?: string | null; project_id?: string | null; cycle_id?: string | null;
  label_ids_add?: string[]; label_ids_remove?: string[];
}
export interface BulkGroup { ids: string[]; patch: BulkPatch }

/** The optimistic local result of a bulk patch on one issue (same semantics as the server: add/remove on the label set). */
export function applyBulkLocal(i: Issue, p: BulkPatch): Issue {
  let labels = i.label_ids;
  if (p.label_ids_add || p.label_ids_remove) {
    const s = new Set(labels);
    for (const l of p.label_ids_add ?? []) s.add(l);
    for (const l of p.label_ids_remove ?? []) s.delete(l);
    labels = [...s];
  }
  return {
    ...i,
    status: p.status ?? i.status,
    priority: (p.priority ?? i.priority) as Issue['priority'],
    assignee_id: p.assignee_id !== undefined ? p.assignee_id : i.assignee_id,
    project_id: p.project_id !== undefined ? p.project_id : i.project_id,
    cycle_id: p.cycle_id !== undefined ? p.cycle_id : i.cycle_id,
    label_ids: labels,
  };
}

/**
 * Undo = the patches that restore each issue's previous values, grouped so that issues needing the same patch share one
 * bulk call. Issues the patch would not change produce nothing.
 */
export function inverseGroups(before: Issue[], p: BulkPatch): BulkGroup[] {
  const groups = new Map<string, BulkGroup>();
  for (const i of before) {
    const inv: BulkPatch = {};
    if (p.status !== undefined && p.status !== i.status) inv.status = i.status;
    if (p.priority !== undefined && p.priority !== i.priority) inv.priority = i.priority;
    if (p.assignee_id !== undefined && p.assignee_id !== i.assignee_id) inv.assignee_id = i.assignee_id;
    if (p.project_id !== undefined && p.project_id !== i.project_id) inv.project_id = i.project_id;
    if (p.cycle_id !== undefined && p.cycle_id !== i.cycle_id) inv.cycle_id = i.cycle_id;
    const had = new Set(i.label_ids);
    const added = (p.label_ids_add ?? []).filter((l) => !had.has(l));
    const removed = (p.label_ids_remove ?? []).filter((l) => had.has(l));
    if (added.length) inv.label_ids_remove = added;
    if (removed.length) inv.label_ids_add = removed;
    if (Object.keys(inv).length === 0) continue;
    const key = JSON.stringify(inv);
    const g = groups.get(key);
    if (g) g.ids.push(i.id); else groups.set(key, { ids: [i.id], patch: inv });
  }
  return [...groups.values()];
}

/** Label toggle on a selection: when every issue has the label remove it from all, otherwise add it to all. */
export function labelTogglePatch(items: Issue[], labelId: string): BulkPatch {
  return items.every((i) => i.label_ids.includes(labelId)) ? { label_ids_remove: [labelId] } : { label_ids_add: [labelId] };
}

export const BULK_MAX = 250;
export const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let k = 0; k < a.length; k += n) o.push(a.slice(k, k + n)); return o; };
