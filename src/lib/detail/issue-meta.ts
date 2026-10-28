// Pure helpers for the issue detail page: branch name, link, identifier matching, sub-issue progress.
import type { Issue } from '@/lib/issues';

export const identifierOf = (i: Pick<Issue, 'id' | 'identifier'>) => i.identifier ?? i.id;

/** Linear-style branch name: `<handle>/<team-n>-<slug>`, ascii, max 60 chars total. Server value wins when present. */
export function branchName(identifier: string, title: string, handle = 'meg'): string {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const head = `${handle.toLowerCase().replace(/[^a-z0-9]+/g, '')}/${identifier.toLowerCase()}`;
  const full = slug ? `${head}-${slug}` : head;
  return full.slice(0, 60).replace(/-+$/, '');
}

export function issueUrl(origin: string, slug: string, identifier: string): string {
  return `${origin.replace(/\/+$/, '')}/w/${encodeURIComponent(slug)}/issue/${encodeURIComponent(identifier)}`;
}

export function findByIdentifier<T extends Pick<Issue, 'id' | 'identifier' | 'deleted_at'>>(issues: readonly T[], ident: string): T | undefined {
  const k = ident.toUpperCase();
  return issues.find((i) => identifierOf(i).toUpperCase() === k);
}

export function progress(children: readonly Pick<Issue, 'status'>[]): { done: number; total: number } {
  const live = children.filter((c) => c.status !== 'canceled');
  return { done: live.filter((c) => c.status === 'done').length, total: live.length };
}

export const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dueState(due: string | null | undefined, today: string): 'none' | 'overdue' | 'soon' | 'later' {
  if (!due || !DUE_RE.test(due)) return 'none';
  if (due < today) return 'overdue';
  const d = (Date.parse(due) - Date.parse(today)) / 86_400_000;
  return d <= 3 ? 'soon' : 'later';
}
