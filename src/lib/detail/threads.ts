import type { Comment } from './api';

/** Replies of a root, oldest first (the list is creation-ordered; sorted anyway so a realtime merge cannot reorder a thread). */
export function repliesOf(all: readonly Comment[], rootId: string): Comment[] {
  return all.filter((c) => c.parent_comment_id === rootId).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : 1));
}

/** Distinct authors of a thread in order of first appearance (root first). Null authors (deleted users) are skipped. */
export function participants(root: Comment, replies: readonly Comment[]): string[] {
  const seen: string[] = [];
  for (const c of [root, ...replies]) if (c.author_id && !seen.includes(c.author_id)) seen.push(c.author_id);
  return seen;
}

export const repliesLabel = (n: number) => `${n} ${n === 1 ? 'reply' : 'replies'}`;

/** A thread is shown collapsed only when it is resolved and nobody chose otherwise. `pref` is the viewer's explicit choice. */
export const threadOpen = (root: Comment, pref: boolean | null) => pref ?? !root.resolved_at;
