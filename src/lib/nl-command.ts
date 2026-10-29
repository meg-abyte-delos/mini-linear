// Cmd+K natural-language actions, parsed client-side (no server route yet).
// "assign to Ada, high priority" -> { assignee_id: 'u3', priority: 2 }. Pure: users/labels are injected.
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, type Issue, type Status } from '@/lib/issues';

export interface NlUser { id: string; name: string }
export interface NlLabel { id: string; name: string }
export type NlPatch = Partial<Pick<Issue, 'status' | 'priority' | 'assignee_id'>> & { add_label_ids?: string[] };
/** `blocked` set => the palette shows the row disabled with that text and must not apply `patch` (never a partial action). */
export interface NlAction { patch: NlPatch; parts: string[]; blocked?: string }
export interface NlOptions { /** People (/me, members) still loading: unresolved "me" reads "Loading members…". */ peopleLoading?: boolean }

const PRIO: [RegExp, Issue['priority']][] = [
  [/\b(urgent|p0|asap)\b/, 1],
  [/\b(high|p1)\b/, 2],
  [/\b(medium|normal|p2)\b/, 3],
  [/\b(low|p3)\b/, 4],
  [/\bno priority\b/, 0],
];
const STATUS_ALIAS: Record<string, Status> = { 'in progress': 'in_progress', started: 'in_progress', doing: 'in_progress', review: 'in_review', 'in review': 'in_review', done: 'done', closed: 'done', complete: 'done', todo: 'todo', 'to do': 'todo', backlog: 'backlog', cancel: 'canceled', canceled: 'canceled', cancelled: 'canceled' };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cue = (name: string) => new RegExp(`(\\bassign (to )?|\\bfor |@)${esc(name.toLowerCase())}\\b`);

/** Full-name match wins; otherwise first name. Several distinct people => tie (no assignee). */
function matchUser(t: string, users: readonly NlUser[]): { user?: NlUser; tie?: NlUser[] } {
  const full = users.filter((u) => cue(u.name).test(t));
  if (full.length === 1) return { user: full[0] };
  const pool = full.length > 1 ? full : users.filter((u) => cue(u.name.split(' ')[0]!).test(t));
  const uniq = pool.filter((u, i) => pool.findIndex((v) => v.id === u.id) === i);
  if (uniq.length === 1) return { user: uniq[0] };
  return uniq.length > 1 ? { tie: uniq } : {};
}

/** Returns null when the text holds no recognised action, so the palette keeps plain search. */
export function parseNlCommand(input: string, users: readonly NlUser[], labels: readonly NlLabel[] = [], me: string | null = null, opts: NlOptions = {}): NlAction | null {
  const t = ` ${input.toLowerCase().replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const patch: NlPatch = {}; const parts: string[] = []; let blocked: string | undefined;

  // Assignee: "assign to X", "assign X", "for X", "@X", "unassign", "assign to me".
  if (/\bunassign\b/.test(t)) { patch.assignee_id = null; parts.push('Unassign'); }
  else if (/\bassign (to )?me\b/.test(t)) {
    if (me) { patch.assignee_id = me; parts.push('Assign to me'); }
    else { blocked = opts.peopleLoading ? 'Loading members…' : "Can't resolve me"; parts.push('Assign to me'); }
  } else {
    const m = matchUser(t, users);
    if (m.user) { patch.assignee_id = m.user.id; parts.push(`Assign to ${m.user.name}`); }
    else if (m.tie) { blocked = `Ambiguous: ${m.tie.map((u) => u.name).join(' / ')}`; parts.push('Assign'); }
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

  if (blocked) return { patch: {}, parts, blocked };
  return parts.length ? { patch, parts } : null;
}

/** Palette row label: "Assign to Ada Byte · Priority High"; a blocked row shows its reason instead. */
export const nlLabel = (a: NlAction, count = 1) => a.blocked ?? `${a.parts.join(' · ')}${count > 1 ? ` (${count} issues)` : ''}`;
