/**
 * Mention syntax in comment bodies (pure, no DB):
 *  - `@[Label](uuid)`  explicit mention by user id (what the editor inserts)
 *  - `@handle`         handle = local part of the member's email (case-insensitive), e.g. @ada for ada@x.io
 * Mentions inside inline code / fenced code blocks are ignored. Emails (a@b.c) are not mentions.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ParsedMentions = { ids: string[]; handles: string[] };
export const MAX_MENTIONS = 50;

export function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]*`/g, " ");
}

export function parseMentions(body: string): ParsedMentions {
  const text = stripCode(body), ids = new Set<string>(), handles = new Set<string>();
  for (const m of text.matchAll(/@\[[^\]\n]{0,200}\]\(([^)\s]{1,64})\)/g)) if (UUID.test(m[1]!)) ids.add(m[1]!.toLowerCase());
  const rest = text.replace(/@\[[^\]\n]{0,200}\]\([^)\s]{1,64}\)/g, " ");
  for (const m of rest.matchAll(/(^|[^\w.@+-])@([a-z0-9][a-z0-9._+-]{0,63})/gi)) {
    const h = m[2]!.replace(/[._+-]+$/, "").toLowerCase();
    if (h) handles.add(h);
  }
  return { ids: [...ids].slice(0, MAX_MENTIONS), handles: [...handles].slice(0, MAX_MENTIONS) };
}

/** Normalise an emoji reaction key: trimmed, 1-32 chars, no whitespace (unicode emoji or :shortcode:). */
export function normalizeEmoji(raw: string): string | null {
  const e = raw.trim();
  if (!e || e.length > 32 || /\s/.test(e)) return null;
  if (/^:[a-z0-9_+-]{1,30}:$/i.test(e)) return e.toLowerCase();
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e) ? e : null;
}
