// Mock data in the M2.2 issue shape. Replaced by Ada's M2.4 contract later.
export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', in_review: 'In review', done: 'Done', canceled: 'Canceled',
};
export const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'] as const;

export const USERS = [
  { id: 'u1', name: 'Meg Abyte', initials: 'MA', hue: 'h1' },
  { id: 'u2', name: 'Linus Patch', initials: 'LP', hue: 'h2' },
  { id: 'u3', name: 'Ada Byte', initials: 'AB', hue: 'h3' },
] as const;

export const LABELS = [
  { id: 'l1', name: 'Bug', hue: 'lb1' },
  { id: 'l2', name: 'Feature', hue: 'lb2' },
  { id: 'l3', name: 'Infra', hue: 'lb3' },
] as const;

export interface Issue {
  id: string; // TEAMKEY-n
  title: string;
  description: string;
  status: Status;
  priority: 0 | 1 | 2 | 3 | 4;
  assignee_id: string | null;
  project_id: string | null;
  cycle_id: string | null;
  label_ids: string[];
  parent_id: string | null;
  sort_key: string;
  version: number;
  created_at: string;
  deleted_at: string | null;
}

const TITLES = ['Set up CI', 'Cronkit parser port', 'Board drag and drop', 'Command palette', 'RLS review', 'CSP nonce middleware', 'Issue detail panel', 'Cycle view', 'Label picker', 'Empty states'];
export const MOCK_ISSUES: Issue[] = TITLES.map((title, i) => ({
  id: `DEL-${i + 1}`, title, description: '', status: STATUSES[i % 5] as Status,
  priority: (i % 5) as Issue['priority'], assignee_id: i % 4 === 3 ? null : (USERS[i % 3]?.id ?? null), project_id: null, cycle_id: null,
  label_ids: i % 3 === 2 ? [] : [LABELS[i % 3]?.id ?? 'l1'], parent_id: null, sort_key: String(i + 1).padStart(4, '0'), version: 1,
  created_at: new Date(Date.UTC(2026, 9, 27 - i)).toISOString(), deleted_at: null,
}));

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

