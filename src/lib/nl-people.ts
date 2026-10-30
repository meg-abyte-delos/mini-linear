// People for the Cmd+K NL parser in API mode: "me" = session user (GET /api/v1/me),
// members = GET /api/v1/w/:slug/members. Only UUID ids are kept, so the Shell isUuid guard still holds.
import { isUuid } from '@/lib/api-client';
import type { NlUser } from '@/lib/nl-command';

export interface NlPeople { users: NlUser[]; me: string | null }
export const EMPTY_PEOPLE: NlPeople = { users: [], me: null };

type Fetch = typeof fetch;
export interface MemberRow { user_id: string; email: string; display_name?: string | null }
export interface MeRow { id: string; email?: string; name?: string | null; display_name?: string | null }

/** "ada.byte@x.io" -> "Ada Byte" (members carry no name column; same local-part rule as /me's fallback). */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.split(/[._+-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ') || email;
}

/** Display name of a person row: display_name when set, else the email-derived name. */
export function personName(p: { email: string; display_name?: string | null }): string {
  return p.display_name?.trim() || nameFromEmail(p.email);
}

/** Pure: API rows -> parser input. Non-UUID ids are dropped; the session user keeps its display_name when set. */
export function toNlPeople(members: readonly MemberRow[], me: MeRow | null): NlPeople {
  const meId = me && isUuid(me.id) ? me.id : null;
  const users = members.filter((m) => isUuid(m.user_id)).map((m) => ({
    id: m.user_id,
    name: (m.user_id === meId && me?.display_name) || m.display_name?.trim() || nameFromEmail(m.email),
  }));
  return { users, me: meId };
}

/** Loads members (all pages, 100 per call) and the session user. Any failure -> what was loaded, never throws. */
export async function fetchNlPeople(slug: string, f: Fetch = fetch): Promise<NlPeople> {
  let me: MeRow | null = null;
  const members: MemberRow[] = [];
  try {
    const r = await f('/api/v1/me');
    if (r.ok) me = (await r.json()) as MeRow;
  } catch { /* no session user: "assign to me" stays off */ }
  try {
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const qs: string = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await f(`/api/v1/w/${slug}/members${qs}`);
      if (!r.ok) break;
      const j = (await r.json()) as { items?: MemberRow[]; next_cursor?: string | null };
      members.push(...(j.items ?? []));
      cursor = j.next_cursor ?? null;
      if (!cursor) break;
    }
  } catch { /* keep what we have */ }
  return toNlPeople(members, me);
}
