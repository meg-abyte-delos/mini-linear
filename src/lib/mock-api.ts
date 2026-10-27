// Mock issues API: zod-validated input, soft delete, ids never reused.
import { z } from 'zod';
import { MOCK_ISSUES, STATUSES, type Issue } from '@/lib/issues';

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
    update(id: string, patch: Partial<IssueInput>): Issue | null {
      const cur = all.find((i) => i.id === id && i.deleted_at === null);
      if (!cur) return null;
      const v = issuePatch.parse(patch);
      const defined = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
      Object.assign(cur, defined, { version: cur.version + 1 });
      return { ...cur };
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
export async function listIssues(): Promise<Issue[]> {
  return store.list();
}
