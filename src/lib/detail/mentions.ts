// @mention helpers shared by the comment composer (autocomplete) and tests. Mirrors the server parser contract:
// `@username` or `@[Display Name](uuid)`.
export interface MentionUser { id: string; name: string; handle: string }

/** The mention being typed at the caret, if any: `@` at start or after whitespace, then up to 39 handle chars. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s)@([a-z0-9._-]{0,39})$/i);
  if (!m) return null;
  return { start: caret - (m[2]?.length ?? 0) - 1, query: m[2] ?? '' };
}

export function suggest(users: readonly MentionUser[], query: string, limit = 6): MentionUser[] {
  const q = query.toLowerCase();
  return users.filter((u) => !q || u.handle.toLowerCase().startsWith(q) || u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, limit);
}

/** Replace the active `@query` with the canonical token. Returns the new text and caret. */
export function insertMention(text: string, at: { start: number; query: string }, u: MentionUser): { text: string; caret: number } {
  const token = `@${u.handle} `;
  const end = at.start + 1 + at.query.length;
  return { text: text.slice(0, at.start) + token + text.slice(end), caret: at.start + token.length };
}

export function extractHandles(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(^|\s)@([a-z0-9][a-z0-9._-]{0,38})/gi)) if (m[2]) out.add(m[2].toLowerCase());
  for (const m of text.matchAll(/@\[[^\]]{1,64}\]\(([0-9a-f-]{36})\)/gi)) if (m[1]) out.add(m[1].toLowerCase());
  return [...out];
}
