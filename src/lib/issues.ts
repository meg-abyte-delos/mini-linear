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
  { id: 'u4', name: 'Rex Review', initials: 'RR', hue: 'h4' },
  { id: 'u5', name: 'Tess Tester', initials: 'TT', hue: 'h5' },
] as const;

export const LABELS = [
  { id: 'l1', name: 'Bug', hue: 'lb1' },
  { id: 'l2', name: 'Feature', hue: 'lb2' },
  { id: 'l3', name: 'Infra', hue: 'lb3' },
] as const;

// M2 API shapes (PR #10): project {id,name,description,team_ids}, cycle {id,team_id,name,start_date,end_date (YYYY-MM-DD)}.
export const PROJECTS = [
  { id: 'p1', name: 'Mini Linear', description: '', team_ids: ['t1'] },
  { id: 'p2', name: 'Cronkit', description: '', team_ids: ['t1'] },
] as const;
export const CYCLES = [
  { id: 'c1', team_id: 't1', name: 'Cycle 1', start_date: '2026-10-05', end_date: '2026-10-18' },
  { id: 'c2', team_id: 't1', name: 'Cycle 2', start_date: '2026-10-19', end_date: '2026-11-01' },
  { id: 'c3', team_id: 't1', name: 'Cycle 3', start_date: '2026-11-02', end_date: '2026-11-15' },
] as const;

export interface Issue {
  id: string; // mock: TEAMKEY-n. API mode: UUID (key); show `identifier`.
  identifier?: string; // API mode: "DEL-12"
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

const TITLES = ['Set up CI', 'Cronkit parser port', 'Board drag and drop', 'Command palette', 'RLS review', 'CSP nonce proxy', 'Issue detail panel', 'Cycle view', 'Label picker', 'Empty states'];
export const MOCK_ISSUES: Issue[] = TITLES.map((title, i) => ({
  id: `DEL-${i + 1}`, title, description: '', status: STATUSES[i % 5] as Status,
  priority: (i % 5) as Issue['priority'], assignee_id: i % 4 === 3 ? null : (USERS[i % 3]?.id ?? null), project_id: PROJECTS[i % 2]?.id ?? null, cycle_id: i % 4 === 3 ? null : (CYCLES[i % 3]?.id ?? null),
  label_ids: i % 3 === 2 ? [] : [LABELS[i % 3]?.id ?? 'l1'], parent_id: null, sort_key: String(i + 1).padStart(4, '0'), version: 1,
  created_at: new Date(Date.UTC(2026, 9, 27 - i)).toISOString(), deleted_at: null,
}));

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}


/** Perf fixture for A4.3 (`?seed=N`, capped): N extra issues spread over all statuses. */
export function seedIssues(n: number): Issue[] {
  const count = Math.max(0, Math.min(5000, Math.floor(n)));
  return Array.from({ length: count }, (_, k) => ({
    id: `DEL-${100 + k}`, title: `Seeded issue ${k + 1}`, description: '', status: STATUSES[k % STATUSES.length] as Status,
    priority: (k % 5) as Issue['priority'], assignee_id: USERS[k % USERS.length]?.id ?? null, project_id: null, cycle_id: null,
    label_ids: k % 3 === 2 ? [] : [LABELS[k % 3]?.id ?? 'l1'], parent_id: null, sort_key: String(1000 + k).padStart(5, '0'), version: 1,
    created_at: new Date(Date.UTC(2026, 9, 27 - (k % 20))).toISOString(), deleted_at: null,
  }));
}

// Lookup data for filters, pickers and the cycles view. Mocks by default; API mode fills it from /labels, /cycles, /projects.
export interface LabelMeta { id: string; name: string; hue: string }
export interface ProjectMeta { id: string; name: string; description: string; team_ids: readonly string[] }
export interface CycleMeta { id: string; team_id: string; name: string; start_date: string; end_date: string }
export interface Meta { labels: readonly LabelMeta[]; projects: readonly ProjectMeta[]; cycles: readonly CycleMeta[] }
export const MOCK_META: Meta = { labels: LABELS, projects: PROJECTS, cycles: CYCLES };
