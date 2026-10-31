import { STATUSES, STATUS_LABEL, type Status } from '@/lib/issues';

interface Entry { summary?: string; action: string; changes?: { field: string; after: unknown }[] }

/** The status an activity entry moved the issue to: the structured change when the server sent one, else parsed from the local wording ("set status to In Progress"). */
export function statusOf(at: Entry): Status | null {
  const ch = at.changes?.find((c) => c.field === 'status');
  if (ch && typeof ch.after === 'string' && (STATUSES as readonly string[]).includes(ch.after)) return ch.after as Status;
  const m = /status (?:to|from .+ to) (.+)$/.exec(at.summary ?? at.action);
  return m ? (STATUSES.find((st) => STATUS_LABEL[st].toLowerCase() === m[1]?.toLowerCase()) ?? null) : null;
}

const statusByLabel = (label: string | undefined): Status | null => STATUSES.find((st) => STATUS_LABEL[st].toLowerCase() === label?.trim().toLowerCase()) ?? null;

/** "changed status from Backlog to Todo" cut around the two status names, so each gets its icon: `lead` + [from icon + fromLabel + " to "] + [to icon + toLabel] + `tail`. */
export interface StatusSplit { lead: string; from: Status | null; fromText: string; to: Status; toText: string; tail: string }

export function splitStatusSummary(text: string): StatusSplit | null {
  const m = /^(.*?(?:changed|set) status )(?:from (.+?) )?to (.+?)(?=, (?:changed|set) |$)(.*)$/.exec(text);
  if (!m) return null;
  const to = statusByLabel(m[3]);
  if (!to) return null;
  // The stored entry says 'In Progress'; the rail, board and list say STATUS_LABEL ('In progress'), so the feed uses STATUS_LABEL too.
  const from = m[2] ? statusByLabel(m[2]) : null;
  return { lead: m[1]!, from, fromText: from ? STATUS_LABEL[from] : (m[2] ?? ''), to, toText: STATUS_LABEL[to], tail: m[4] ?? '' };
}
