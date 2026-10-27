// Mock data in the M2.2 issue shape. Replaced by Ada's M2.4 contract later.
export const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', in_review: 'In review', done: 'Done', canceled: 'Canceled',
};
export const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'] as const;

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
}

const TITLES = ['Set up CI', 'Cronkit parser port', 'Board drag and drop', 'Command palette', 'RLS review', 'CSP nonce middleware', 'Issue detail panel', 'Cycle view', 'Label picker', 'Empty states'];
export const MOCK_ISSUES: Issue[] = TITLES.map((title, i) => ({
  id: `DEL-${i + 1}`, title, description: '', status: STATUSES[i % 5] as Status,
  priority: (i % 5) as Issue['priority'], assignee_id: null, project_id: null, cycle_id: null,
  label_ids: [], parent_id: null, sort_key: String(i + 1).padStart(4, '0'), version: 1,
}));

export async function listIssues(): Promise<Issue[]> {
  return MOCK_ISSUES;
}
