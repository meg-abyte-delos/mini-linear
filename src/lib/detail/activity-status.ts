import { STATUSES, STATUS_LABEL, type Status } from '@/lib/issues';

interface Entry { summary?: string; action: string; changes?: { field: string; after: unknown }[] }

/** The status an activity entry moved the issue to: the structured change when the server sent one, else parsed from the local wording ("set status to In Progress"). */
export function statusOf(at: Entry): Status | null {
  const ch = at.changes?.find((c) => c.field === 'status');
  if (ch && typeof ch.after === 'string' && (STATUSES as readonly string[]).includes(ch.after)) return ch.after as Status;
  const m = /status (?:to|from .+ to) (.+)$/.exec(at.summary ?? at.action);
  return m ? (STATUSES.find((st) => STATUS_LABEL[st].toLowerCase() === m[1]?.toLowerCase()) ?? null) : null;
}
