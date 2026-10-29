// Cmd+K natural-language actions, parsed client-side (no server route yet).
// "assign to Ada, high priority" -> { assignee_id: 'u3', priority: 2 }. Pure: users/labels are injected.
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, type Issue, type Status } from '@/lib/issues';

export interface NlUser { id: string; name: string }
export interface NlLabel { id: string; name: string }
export type NlPatch = Partial<Pick<Issue, 'status' | 'priority' | 'assignee_id'>> & { add_label_ids?: string[] };
export interface NlAction { patch: NlPatch; parts: string[] }

const PRIO: [RegExp, Issue['priority']][] = [
  [/\b(urgent|p0|asap)\b/, 1],
  [/\b(high|p1)\b/, 2],
  [/\b(medium|normal|p2)\b/, 3],
  [/\b(low|p3)\b/, 4],
  [/\bno priority\b/, 0],
];
const STATUS_ALIAS: Record<string, Status> = { 'in progress': 'in_progress', started: 'in_progress', doing: 'in_progress', review: 'in_review', 'in review': 'in_review', done: 'done', closed: 'done', complete: 'done', todo: 'todo', 'to do': 'todo', backlog: 'backlog', cancel: 'canceled', canceled: 'canceled', cancelled: 'canceled' };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Returns null when the text holds no recognised action, so the palette keeps plain search. */
export function parseNlCommand(input: string, users: readonly NlUser[], labels: readonly NlLabel[] = [], me: string | null = null): NlAction | null {
  const t = ` ${input.toLowerCase().replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const patch: NlPatch = {}; const parts: string[] = [];

  // Assignee: "assign to X", "assign X", "for X", "@X", "unassign", "assign to me".
  if (/\bunassign\b/.test(t)) { patch.assignee_id = null; parts.push('Unassign'); }
  else if (me && /\bassign (to )?me\b/.test(t)) { patch.assignee_id = me; parts.push('Assign to me'); }
  else {
    for (const u of users) {
      const first = esc(u.name.split(' ')[0]!.toLowerCase()); const full = esc(u.name.toLowerCase());
      if (new RegExp(`(\\bassign (to )?|\\bfor |@)(${full}|${first})\\b`).test(t)) { patch.assignee_id = u.id; parts.push(`Assign to ${u.name}`); break; }
    }
  }
  // Priority: only with an explicit cue ("priority", "prio", "urgent", "pN") to avoid false hits on titles.
  if (/\b(priority|prio|urgent|p[0-3])\b/.test(t)) {
    const hit = PRIO.find(([re]) => re.test(t));
    if (hit) { patch.priority = hit[1]; parts.push(`Priority ${PRIORITY_LABEL[hit[1]]}`); }
  }
  // Status: "move to X", "mark (as) X", "set status X".
  const sm = t.match(/\b(?:move to|mark as|mark|status|set to) ([a-z ]+?) (?=$|and |priority|assign|label)/) ?? t.match(/\b(?:move to|mark as|mark) ([a-z ]+)/);
  if (sm) {
    const words = sm[1]!.trim();
    const key = Object.keys(STATUS_ALIAS).sort((a, b) => b.length - a.length).find((k) => words.startsWith(k));
    const st = key ? STATUS_ALIAS[key] : (STATUSES as readonly string[]).includes(words) ? (words as Status) : undefined;
    if (st) { patch.status = st; parts.push(`Move to ${STATUS_LABEL[st]}`); }
  }
  // Labels: "label bug", "tag infra", "add label feature".
  const add = labels.filter((l) => new RegExp(`\\b(label|tag)(ed)? (as )?${esc(l.name.toLowerCase())}\\b`).test(t)).map((l) => l.id);
  if (add.length) { patch.add_label_ids = add; parts.push(`Label ${labels.filter((l) => add.includes(l.id)).map((l) => l.name).join(', ')}`); }

  return parts.length ? { patch, parts } : null;
}

/** Palette row label: "Assign to Ada Byte · Priority High". */
export const nlLabel = (a: NlAction, count = 1) => `${a.parts.join(' · ')}${count > 1 ? ` (${count} issues)` : ''}`;
