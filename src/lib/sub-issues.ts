// Sub-issue roll-up for list rows and board cards: parent id -> { done, total } over live (not deleted, not canceled) children.
export interface SubStat { done: number; total: number; pct: number }

export function subIssueStats(issues: readonly { id: string; parent_id: string | null; status: string; deleted_at: string | null }[]): Map<string, SubStat> {
  const m = new Map<string, SubStat>();
  for (const i of issues) {
    if (!i.parent_id || i.deleted_at || i.status === 'canceled') continue;
    const s = m.get(i.parent_id) ?? { done: 0, total: 0, pct: 0 };
    s.total += 1;
    if (i.status === 'done') s.done += 1;
    s.pct = Math.round((s.done / s.total) * 100);
    m.set(i.parent_id, s);
  }
  return m;
}
