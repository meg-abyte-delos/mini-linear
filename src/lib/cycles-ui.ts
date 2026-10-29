// Pure helpers for the Cycles list rows (CyclesList.tsx), unit-tested in tests/unit/cycles-ui.test.ts.
import type { Issue, CycleMeta } from '@/lib/issues';
import type { CycleBucket } from '@/lib/filters';

export interface CycleScope { total: number; started: number; done: number; pct: number }

/** Scope of one cycle: done counts done + canceled (Linear counts canceled as closed scope). */
export function cycleScope(issues: readonly Pick<Issue, 'cycle_id' | 'status'>[], cycleId: string): CycleScope {
  let total = 0, started = 0, done = 0;
  for (const i of issues) {
    if (i.cycle_id !== cycleId) continue;
    total++;
    if (i.status === 'done' || i.status === 'canceled') done++;
    else if (i.status === 'in_progress' || i.status === 'in_review') started++;
  }
  return { total, started, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Linear-style timing hint: "3 days left" (active, end inclusive), "Starts in 2 days" (upcoming), "Ended Oct 13" is left to the dates column. */
export function cycleTiming(c: Pick<CycleMeta, 'start_date' | 'end_date'>, today: string, bucket: CycleBucket): string | null {
  if (bucket === 'active') {
    const n = Math.round((utc(c.end_date) - utc(today)) / DAY) + 1;
    return n <= 1 ? 'Last day' : `${n} days left`;
  }
  if (bucket === 'upcoming') {
    const n = Math.round((utc(c.start_date) - utc(today)) / DAY);
    return n <= 1 ? 'Starts tomorrow' : `Starts in ${n} days`;
  }
  return null;
}
