// Browser-side calls for workspace + team settings (Area 9). Pure over an injectable fetch so it is unit-testable.
export type TeamRole = 'admin' | 'member' | 'guest';
export type WorkspaceSettings = { id: string; slug: string; name: string; logo_url: string | null; role: string };
export type Team = { id: string; name: string; key: string };
export type TeamMember = { user_id: string; email: string; role: TeamRole };
export type Member = { user_id: string; email: string; role: string };
type Fetch = typeof fetch;
export class SettingsError extends Error { constructor(public status: number, message: string) { super(message); } }

const base = (slug: string) => `/api/v1/w/${encodeURIComponent(slug)}`;
async function call<T>(f: Fetch, method: string, url: string, body?: unknown): Promise<T> {
  const r = await f(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new SettingsError(r.status, (j as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`);
  return j as T;
}

export const getSettings = (slug: string, f: Fetch = fetch) => call<WorkspaceSettings>(f, 'GET', `${base(slug)}/settings`);
/** Only changed fields are sent; an empty logo string clears the logo. */
export function settingsPatch(prev: Pick<WorkspaceSettings, 'name' | 'slug' | 'logo_url'>, next: { name: string; slug: string; logo_url: string }) {
  const p: Record<string, string> = {};
  if (next.name.trim() !== prev.name) p.name = next.name.trim();
  if (next.slug.trim() !== prev.slug) p.slug = next.slug.trim();
  if (next.logo_url.trim() !== (prev.logo_url ?? '')) p.logo_url = next.logo_url.trim();
  return p;
}
export const patchSettings = (slug: string, patch: Record<string, string>, f: Fetch = fetch) => call<WorkspaceSettings>(f, 'PATCH', `${base(slug)}/settings`, patch);
export const listTeams = async (slug: string, f: Fetch = fetch) => (await call<{ items: Team[] }>(f, 'GET', `${base(slug)}/teams?limit=100`)).items;
export const createTeam = (slug: string, name: string, key: string, f: Fetch = fetch) => call<Team>(f, 'POST', `${base(slug)}/teams`, { name, key });
export const renameTeam = (slug: string, id: string, name: string, f: Fetch = fetch) => call<Team>(f, 'PATCH', `${base(slug)}/teams/${id}`, { name });
export const deleteTeam = (slug: string, id: string, f: Fetch = fetch) => call<void>(f, 'DELETE', `${base(slug)}/teams/${id}`);
export const listMembers = async (slug: string, f: Fetch = fetch) => (await call<{ items: Member[] }>(f, 'GET', `${base(slug)}/members?limit=100`)).items;
export const listTeamMembers = async (slug: string, team: string, f: Fetch = fetch) => (await call<{ items: TeamMember[] }>(f, 'GET', `${base(slug)}/teams/${team}/members`)).items;
export const addTeamMember = (slug: string, team: string, uid: string, role: TeamRole, f: Fetch = fetch) => call<TeamMember>(f, 'POST', `${base(slug)}/teams/${team}/members/${uid}`, { role });
export const setTeamRole = (slug: string, team: string, uid: string, role: TeamRole, f: Fetch = fetch) => call<TeamMember>(f, 'PATCH', `${base(slug)}/teams/${team}/members/${uid}`, { role });
export const removeTeamMember = (slug: string, team: string, uid: string, f: Fetch = fetch) => call<void>(f, 'DELETE', `${base(slug)}/teams/${team}/members/${uid}`);
/** Team key suggestion from a name: first letters, 2-5 uppercase A-Z (matches the API's ^[A-Z]{2,5}$). */
export function suggestKey(name: string) {
  const words = name.normalize('NFD').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/).filter(Boolean);
  let k = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '');
  k = k.toUpperCase().slice(0, 5);
  return k.length >= 2 ? k : (k + 'XX').slice(0, 2);
}

// ---- Workspace members + invites (Members page). The API has no POST /members: people join through invites.
export type MemberRow = Member & { id?: string };
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';
export type Invite = { id: string; email: string; role: string; expires_at: string };
/** All pages of GET /members (100 per call, capped at 20 pages). */
export async function listAllMembers(slug: string, f: Fetch = fetch): Promise<MemberRow[]> {
  const out: MemberRow[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const j: { items?: MemberRow[]; next_cursor?: string | null } = await call(f, 'GET', `${base(slug)}/members?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(j.items ?? []));
    cursor = j.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}
export const setMemberRole = (slug: string, uid: string, role: WorkspaceRole, f: Fetch = fetch) => call<{ user_id: string; role: string }>(f, 'PATCH', `${base(slug)}/members/${uid}`, { role });
export const removeMember = (slug: string, uid: string, f: Fetch = fetch) => call<void>(f, 'DELETE', `${base(slug)}/members/${uid}`);
/** Admin-only on the API: other roles get 403. */
export const listInvites = async (slug: string, f: Fetch = fetch) => (await call<{ items: Invite[] }>(f, 'GET', `${base(slug)}/invites?limit=100`)).items;
export const createInvite = (slug: string, email: string, role: 'admin' | 'member' | 'guest', f: Fetch = fetch) => call<{ id: string; email: string; role: string }>(f, 'POST', `${base(slug)}/invites`, { email: email.trim().toLowerCase(), role });
export const resendInvite = (slug: string, id: string, f: Fetch = fetch) => call<void>(f, 'POST', `${base(slug)}/invites/${id}/resend`);
export const revokeInvite = (slug: string, id: string, f: Fetch = fetch) => call<void>(f, 'DELETE', `${base(slug)}/invites/${id}`);
/** Case-insensitive match on name or email; an empty query keeps everyone. */
export const matchesMember = (m: { email: string }, name: string, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s);
};
