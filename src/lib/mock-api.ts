// Mock issues API: zod-validated input, soft delete, ids never reused.
import { z } from 'zod';
import { MOCK_ISSUES, STATUSES, type Issue, type Status } from '@/lib/issues';
import { moveIssue } from '@/lib/move';

export const issueInput = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(100_000).default(''),
  status: z.enum(STATUSES).default('todo'),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(0),
  assignee_id: z.string().nullable().default(null),
});
// Patch schema: no defaults, so omitted fields stay untouched on update.
export const issuePatch = z.object({
  title: issueInput.shape.title.optional(),
  description: z.string().max(100_000).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  assignee_id: z.string().nullable().optional(),
  label_ids: z.array(z.string()).max(50).optional(),
}).strict();
export type IssueInput = z.input<typeof issueInput>;

export function createStore(seed: Issue[] = []) {
  const all: Issue[] = seed.map((i) => ({ ...i }));
  // Counter only ever goes up: soft-deleted ids stay reserved.
  let next = all.reduce((m, i) => Math.max(m, Number(i.id.split('-')[1]) || 0), 0) + 1;
  return {
    list: (): Issue[] => all.filter((i) => i.deleted_at === null).map((i) => ({ ...i })),
    create(input: IssueInput): Issue {
      const v = issueInput.parse(input);
      const n = next++;
      const issue: Issue = {
        ...v, id: `DEL-${n}`, project_id: null, cycle_id: null, label_ids: [], parent_id: null,
        sort_key: String(n).padStart(4, '0'), version: 1, created_at: new Date().toISOString(), deleted_at: null,
      };
      all.push(issue);
      return { ...issue };
    },
    update(id: string, patch: z.input<typeof issuePatch>): Issue | null {
      const cur = all.find((i) => i.id === id && i.deleted_at === null);
      if (!cur) return null;
      const v = issuePatch.parse(patch);
      const defined = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
      Object.assign(cur, defined, { version: cur.version + 1 });
      return { ...cur };
    },
    // Reorder / change status through the pure moveIssue; deleted rows stay in place. Null on unknown or deleted id.
    move(id: string, status: Status, beforeId: string | null): Issue | null {
      const cur = all.find((i) => i.id === id && i.deleted_at === null);
      if (!cur) return null;
      const out = moveIssue(all, id, status, beforeId);
      if (out !== all) all.splice(0, all.length, ...(out as Issue[]));
      return { ...(all.find((i) => i.id === id) as Issue) };
    },
    // API mode: put a server row into the local snapshot (replace by id, or append). The server owns id, identifier and version.
    upsert(issue: Issue): void {
      const at = all.findIndex((i) => i.id === issue.id);
      if (at < 0) all.push({ ...issue }); else all[at] = { ...issue };
    },
    remove(id: string): boolean {
      const cur = all.find((i) => i.id === id && i.deleted_at === null);
      if (!cur) return false;
      cur.deleted_at = new Date().toISOString();
      cur.version += 1;
      return true;
    },
  };
}

export const store = createStore(MOCK_ISSUES);
// Simulation modes for the mock API (via ?state=): loading = slow response, error = failure, empty = no issues.
export type SimState = 'loading' | 'error' | 'empty' | undefined;
export const LOADING_DELAY_MS = 1500;
export function parseSimState(v: string | string[] | undefined): SimState {
  const x = Array.isArray(v) ? v[0] : v;
  return x === 'loading' || x === 'error' || x === 'empty' ? x : undefined;
}
export async function listIssues(sim?: SimState, delayMs = LOADING_DELAY_MS): Promise<Issue[]> {
  if (sim === 'loading') await new Promise((r) => setTimeout(r, delayMs));
  if (sim === 'error') throw new Error('Could not load issues');
  if (sim === 'empty') return [];
  return store.list();
}
