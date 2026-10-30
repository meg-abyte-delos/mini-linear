import { POLICIES, ROLES, type Exp, type PolicyName, type RoleName, type Six } from './roles';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Resources the harness creates fresh for every cell (so destructive cells never poison each other). */
export type Kind = 'issue' | 'issue2' | 'comment' | 'relation' | 'attachment' | 'project' | 'milestone' | 'update' | 'cycle' | 'label' | 'group'
  | 'view' | 'trashed' | 'ghconn' | 'webhook' | 'delivery' | 'apikey' | 'invite' | 'target' | 'team' | 'state' | 'template' | 'notif';
export type T = Record<string, string>;
export type Row = {
  m: Method; path: string; needs?: Kind[]; policy: PolicyName | Six;
  /** success status for allowed callers */
  ok: number; body?: (t: T) => unknown; headers?: Record<string, string>; query?: string;
  /** API-key and webhook management: refused to every API key, whatever its scope */
  sessionOnly?: boolean; stream?: boolean; prep?: 'react'; variant?: string;
  over?: Partial<Record<RoleName, Exp>>; note?: string;
};
const IF1 = { 'if-match': '1' };
let cyc = 0;
export const nextCycle = () => { const d = new Date(Date.UTC(2060, 0, 1) + cyc++ * 20 * 86400000); const e = new Date(d.getTime() + 13 * 86400000); return { start_date: d.toISOString().slice(0, 10), end_date: e.toISOString().slice(0, 10) }; };
export const letters = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const r = (m: Method, path: string, policy: PolicyName | Six, ok: number, o: Partial<Row> = {}): Row => ({ m, path, policy, ok, ...o });

export const ROWS: Row[] = [
  // ---- workspace, settings, members, audit, invites, api keys, webhooks
  r('GET', '/', 'everyone', 200),
  r('GET', '/settings', 'everyone', 200),
  r('PATCH', '/settings', 'adminOnly', 200, { body: () => ({ name: 'W One' }) }),
  r('GET', '/members', 'memberPlus', 200),
  r('PATCH', '/members/{target}', 'adminOnly', 200, { needs: ['target'], body: () => ({ role: 'member' }) }),
  r('DELETE', '/members/{target}', 'adminOnly', 204, { needs: ['target'] }),
  r('GET', '/audit', 'adminOnly', 200),
  r('GET', '/invites', 'adminOnly', 200),
  r('POST', '/invites', 'adminOnly', 201, { body: () => ({ email: `inv-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, role: 'member' }) }),
  r('DELETE', '/invites/{invite}', 'adminOnly', 204, { needs: ['invite'] }),
  r('POST', '/invites/{invite}/resend', 'adminOnly', 200, { needs: ['invite'] }),
  r('GET', '/api-keys', 'everyone', 200, { sessionOnly: true }),
  r('POST', '/api-keys', 'everyone', 201, { sessionOnly: true, body: () => ({ name: 'k', scope: 'read' }), variant: 'scope=read', note: 'a guest may only mint read-scope keys' }),
  r('POST', '/api-keys', 'memberPlus', 201, { sessionOnly: true, body: () => ({ name: 'k', scope: 'write' }), variant: 'scope=write', note: 'guests get 403 for any scope above read' }),
  r('DELETE', '/api-keys/{apikey}', 'keyOwner', 204, { needs: ['apikey'], sessionOnly: true }),
  r('GET', '/webhooks', 'adminOnly', 200, { sessionOnly: true }),
  r('POST', '/webhooks', 'adminOnly', 201, { sessionOnly: true, body: () => ({ url: 'https://example.com/hook', events: ['issue.created'] }) }),
  r('GET', '/webhooks/{webhook}', 'adminOnly', 200, { needs: ['webhook'], sessionOnly: true }),
  r('PATCH', '/webhooks/{webhook}', 'adminOnly', 200, { needs: ['webhook'], sessionOnly: true, body: () => ({ active: false }) }),
  r('DELETE', '/webhooks/{webhook}', 'adminOnly', 204, { needs: ['webhook'], sessionOnly: true }),
  r('GET', '/webhooks/{webhook}/deliveries', 'adminOnly', 200, { needs: ['webhook'], sessionOnly: true }),
  r('POST', '/webhooks/{webhook}/deliveries/{delivery}/redeliver', 'adminOnly', 202, { needs: ['delivery'], sessionOnly: true }),
  r('GET', '/integrations/github', 'memberPlus', 200),
  r('PUT', '/integrations/github', 'adminOnly', 200, { needs: ['ghconn'] }),
  r('DELETE', '/integrations/github', 'adminOnly', 204, { needs: ['ghconn'] }),
  r('GET', '/integrations/github/links', 'everyone', 200, { query: 'issue_id={issue}', needs: ['issue'] }),
  r('GET', '/integrations/github/teams/{team}', 'teamRoleRead', 200, { needs: ['team'] }),
  r('PUT', '/integrations/github/teams/{team}', 'teamAdmin', 200, { needs: ['team'], body: () => ({ on_pr_merge: 'done' }) }),
  // ---- teams
  r('GET', '/teams', 'everyone', 200),
  r('POST', '/teams', 'adminOnly', 201, { body: () => ({ name: 'T' + Math.random().toString(36).slice(2, 8), key: letters() }) }),
  r('PATCH', '/teams/{team}', 'teamAdmin', 200, { needs: ['team'], body: () => ({ name: 'Renamed' }) }),
  r('DELETE', '/teams/{team}', 'adminOnly', 204, { needs: ['team'] }),
  r('GET', '/teams/{team}/members', 'teamPublic', 200, { needs: ['team'] }),
  r('POST', '/teams/{team}/members/{target}', 'teamAdmin', 201, { needs: ['team', 'target'], body: () => ({}) }),
  r('PATCH', '/teams/{team}/members/{memberId}', 'teamAdmin', 200, { needs: ['team'], body: () => ({ role: 'admin' }) }),
  r('DELETE', '/teams/{team}/members/{target}', 'teamAdmin', 204, { needs: ['team', 'target'] }),
  r('GET', '/teams/{team}/settings', 'teamRead', 200, { needs: ['team'] }),
  r('PATCH', '/teams/{team}/settings', 'teamAdminHidden', 200, { needs: ['team'], body: () => ({ estimate_allow_zero: true }), headers: IF1 }),
  r('GET', '/teams/{team}/cycle-settings', 'teamRoleRead', 200, { needs: ['team'] }),
  r('PUT', '/teams/{team}/cycle-settings', 'teamAdmin', 200, { needs: ['team'], body: () => ({ enabled: false }), headers: { 'if-match': '0' } }),
  r('POST', '/teams/{team}/cycles/ensure', 'teamAdmin', 200, { needs: ['team'] }),
  r('GET', '/teams/{team}/states', 'teamRead', 200, { needs: ['team'] }),
  r('POST', '/teams/{team}/states', 'teamAdmin', 201, { needs: ['team'], body: () => ({ name: 'S' + Math.random().toString(36).slice(2, 6), color: '#112233', category: 'started', position: 99 }) }),
  r('GET', '/teams/{team}/states/{state}', 'teamRead', 200, { needs: ['team', 'state'] }),
  r('PATCH', '/teams/{team}/states/{state}', 'teamAdmin', 200, { needs: ['team', 'state'], body: () => ({ color: '#445566' }), headers: IF1 }),
  r('DELETE', '/teams/{team}/states/{state}', 'teamAdmin', 204, { needs: ['team', 'state'], headers: IF1 }),
  r('GET', '/teams/{team}/templates', 'teamRoleRead', 200, { needs: ['team'] }),
  r('POST', '/teams/{team}/templates', 'teamAdmin', 201, { needs: ['team'], body: () => ({ name: 'tpl' + Math.random().toString(36).slice(2, 6) }) }),
  r('GET', '/teams/{team}/templates/{template}', 'teamRoleRead', 200, { needs: ['team', 'template'] }),
  r('PATCH', '/teams/{team}/templates/{template}', 'teamAdmin', 200, { needs: ['team', 'template'], body: () => ({ title: 'x' }), headers: IF1 }),
  r('DELETE', '/teams/{team}/templates/{template}', 'teamAdmin', 204, { needs: ['team', 'template'] }),
  // ---- issues
  r('GET', '/issues', 'everyone', 200),
  r('POST', '/issues', 'issueCreate', 201, { body: (t) => ({ title: 'new', team_id: t.t1 }) }),
  r('POST', '/issues/bulk', 'bulk', 200, { needs: ['issue'], body: (t) => ({ ids: [t.issue], patch: { priority: 2 } }) }),
  r('GET', '/issues/{issue}', 'issueRead', 200, { needs: ['issue'] }),
  r('PATCH', '/issues/{issue}', 'issueWrite', 200, { needs: ['issue'], body: () => ({ title: 'patched' }), headers: IF1 }),
  r('DELETE', '/issues/{issue}', 'issueWrite', 204, { needs: ['issue'], headers: IF1 }),
  r('GET', '/issues/{issue}/activity', 'issueRead', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/archive', 'issueWrite', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/unarchive', 'issueWrite', 200, { needs: ['issue'] }),
  r('POST', '/issues/{trashed}/restore', 'issueWrite', 200, { needs: ['trashed'] }),
  r('GET', '/issues/{issue}/children', 'issueRead', 200, { needs: ['issue'] }),
  r('GET', '/issues/{issue}/attachments', 'issueRead', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/attachments', 'issueWrite', 201, { needs: ['issue'], body: () => ({ url: 'https://example.com/doc' }) }),
  r('DELETE', '/issues/{issue}/attachments/{attachment}', 'authorOrAdmin', 204, { needs: ['issue', 'attachment'] }),
  r('POST', '/issues/{issue}/attachments/uploads', 'issueWrite', 201, { needs: ['issue'], body: () => ({ filename: 'a.txt', mime_type: 'text/plain', size_bytes: 1 }) }),
  r('GET', '/issues/{issue}/attachments/{attachment}/content', 'issueRead', 404, { needs: ['issue', 'attachment'] }),
  r('PUT', '/issues/{issue}/attachments/{attachment}/content', 'issueWrite', 404, { needs: ['issue', 'attachment'] }),
  r('GET', '/issues/{issue}/comments', 'issueRead', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/comments', 'issueWrite', 201, { needs: ['issue'], body: () => ({ body: 'hello' }) }),
  r('GET', '/issues/{issue}/relations', 'issueRead', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/relations', 'issueWrite', 201, { needs: ['issue', 'issue2'], body: (t) => ({ type: 'related', related_issue_id: t.issue2 }) }),
  r('DELETE', '/issues/{issue}/relations/{relation}', 'issueWrite', 204, { needs: ['issue', 'relation'] }),
  r('GET', '/issues/{issue}/shares', 'issueWrite', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/shares', 'issueWrite', 201, { needs: ['issue'], body: (t) => ({ guest_user_id: t.guestUnsharedId }) }),
  r('DELETE', '/issues/{issue}/shares/{guestId}', 'issueWrite', 204, { needs: ['issue'] }),
  r('GET', '/issues/{issue}/subscription', 'issueRead', 200, { needs: ['issue'] }),
  r('PUT', '/issues/{issue}/subscription', 'issueRead', 200, { needs: ['issue'] }),
  r('DELETE', '/issues/{issue}/subscription', 'issueRead', 204, { needs: ['issue'] }),
  r('GET', '/subscriptions', 'memberPlus', 200),
  r('PUT', '/subscriptions/{kind}/{project}', 'projectWrite', 204, { needs: ['project'], note: 'outsideTeam 404: same pvisible rule as GET /projects/{project}' }),
  r('DELETE', '/subscriptions/{kind}/{project}', 'projectWrite', 204, { needs: ['project'], note: 'outsideTeam 404: same pvisible rule as GET /projects/{project}' }),
  r('GET', '/issues/{issue}/presence', 'issueRead', 200, { needs: ['issue'] }),
  r('POST', '/issues/{issue}/presence', 'issueRead', 200, { needs: ['issue'] }),
  r('DELETE', '/issues/{issue}/presence', 'issueRead', 200, { needs: ['issue'] }),
  // ---- comments
  r('GET', '/comments/{comment}', 'issueRead', 200, { needs: ['comment'] }),
  r('PATCH', '/comments/{comment}', 'authorOnly', 200, { needs: ['comment'], body: () => ({ body: 'edited' }), headers: IF1 }),
  r('DELETE', '/comments/{comment}', 'authorOrAdmin', 204, { needs: ['comment'], headers: IF1 }),
  r('POST', '/comments/{comment}/resolve', 'issueWrite', 200, { needs: ['comment'] }),
  r('POST', '/comments/{comment}/unresolve', 'issueWrite', 200, { needs: ['comment'] }),
  r('GET', '/comments/{comment}/reactions', 'issueRead', 200, { needs: ['comment'] }),
  r('POST', '/comments/{comment}/reactions', 'issueWrite', 201, { needs: ['comment'], body: () => ({ emoji: '👍' }) }),
  r('DELETE', '/comments/{comment}/reactions', 'issueWrite', 204, { needs: ['comment'], prep: 'react', query: 'emoji=%F0%9F%91%8D' }),
  // ---- labels, groups
  r('GET', '/labels', 'memberPlus', 200),
  r('POST', '/labels', 'memberPlus', 201, { body: () => ({ name: 'l' + Math.random().toString(36).slice(2, 8), color: '#aabbcc', team_id: null, group_id: null, description: '' }) }),
  r('GET', '/labels/{label}', 'memberPlus', 200, { needs: ['label'] }),
  r('PATCH', '/labels/{label}', 'memberPlus', 200, { needs: ['label'], body: () => ({ description: 'd' }), headers: IF1 }),
  r('DELETE', '/labels/{label}', 'adminOnly', 204, { needs: ['label'], headers: IF1 }),
  r('GET', '/label-groups', 'memberPlus', 200),
  r('POST', '/label-groups', 'adminOnly', 201, { body: () => ({ name: 'g' + Math.random().toString(36).slice(2, 8), color: '#aabbcc', team_id: null }) }),
  r('GET', '/label-groups/{group}', 'memberPlus', 200, { needs: ['group'] }),
  r('PATCH', '/label-groups/{group}', 'adminOnly', 200, { needs: ['group'], body: () => ({ color: '#001122' }), headers: IF1 }),
  r('DELETE', '/label-groups/{group}', 'adminOnly', 204, { needs: ['group'], headers: IF1 }),
  // ---- projects
  r('GET', '/projects', 'filteredList', 200),
  r('POST', '/projects', 'projectCreate', 201, { body: (t) => ({ name: 'p' + Math.random().toString(36).slice(2, 8), team_ids: [t.t1] }) }),
  r('GET', '/projects/{project}', 'projectRead', 200, { needs: ['project'] }),
  r('PATCH', '/projects/{project}', 'projectWrite', 200, { needs: ['project'], body: () => ({ description: 'd' }), headers: IF1 }),
  r('DELETE', '/projects/{project}', 'adminOnly', 204, { needs: ['project'], headers: IF1 }),
  r('GET', '/projects/{project}/milestones', 'projectRead', 200, { needs: ['project'] }),
  r('POST', '/projects/{project}/milestones', 'projectWrite', 201, { needs: ['project'], body: () => ({ name: 'm' }) }),
  r('GET', '/project-milestones/{milestone}', 'projectRead', 200, { needs: ['milestone'] }),
  r('PATCH', '/project-milestones/{milestone}', 'projectWrite', 200, { needs: ['milestone'], body: () => ({ name: 'm2' }), headers: IF1 }),
  r('DELETE', '/project-milestones/{milestone}', 'projectWrite', 204, { needs: ['milestone'], headers: IF1 }),
  r('GET', '/projects/{project}/updates', 'projectRead', 200, { needs: ['project'] }),
  r('POST', '/projects/{project}/updates', 'projectWrite', 201, { needs: ['project'], body: () => ({ health: 'on_track', body: 'ok' }) }),
  r('PATCH', '/project-updates/{update}', 'authorOnly', 200, { needs: ['update'], body: () => ({ body: 'b2' }), headers: IF1 }),
  r('DELETE', '/project-updates/{update}', 'authorOrAdmin', 204, { needs: ['update'], headers: IF1 }),
  // ---- cycles
  r('GET', '/cycles', 'memberPlus', 200),
  r('POST', '/cycles', 'adminOnly', 201, { body: (t) => ({ team_id: t.t1, name: 'c' + Math.random().toString(36).slice(2, 6), ...nextCycle() }) }),
  r('GET', '/cycles/{cycle}', 'cycleRead', 200, { needs: ['cycle'] }),
  r('PATCH', '/cycles/{cycle}', 'adminOnly', 200, { needs: ['cycle'], body: () => ({ name: 'cc' }), headers: IF1 }),
  r('DELETE', '/cycles/{cycle}', 'adminOnly', 204, { needs: ['cycle'], headers: IF1 }),
  r('GET', '/cycles/{cycle}/burndown', 'cycleRead', 200, { needs: ['cycle'] }),
  r('GET', '/cycles/{cycle}/stats', 'cycleRead', 200, { needs: ['cycle'] }),
  r('POST', '/cycles/{cycle}/complete', 'adminOnly', 200, { needs: ['cycle'] }),
  r('POST', '/cycles/snapshot', 'adminOnly', 200),
  r('GET', '/cycles/window', 'memberPlus', 200, { query: 'team_id={t1}', over: { outsideTeam: 422 } }),
  // ---- views, search, sync, presence, events
  r('GET', '/views', 'memberPlus', 200),
  r('POST', '/views', 'memberPlus', 201, { body: () => ({ name: 'v' + Math.random().toString(36).slice(2, 6), shared: false, team_id: null, layout: 'list', filters: { op: 'and', rules: [] }, display: {} }) }),
  r('GET', '/views/{view}', 'viewOwn', 200, { needs: ['view'] }),
  r('PATCH', '/views/{view}', 'viewOwn', 200, { needs: ['view'], body: () => ({ name: 'vv' }), headers: IF1 }),
  r('DELETE', '/views/{view}', 'viewOwn', 204, { needs: ['view'], headers: IF1 }),
  r('GET', '/view-state', 'memberPlus', 200),
  r('PUT', '/view-state', 'memberPlus', 200, { headers: { 'if-match': '0' }, body: () => ({ scope: 'all', layout: 'list', filters: { op: 'and', rules: [] }, display: {} }) }),
  r('DELETE', '/view-state', 'memberPlus', 204, { query: 'scope=all' }),
  r('GET', '/views/favorites', 'memberPlus', 200),
  r('PUT', '/views/{view}/favorite', 'viewOwn', 200, { needs: ['view'] }),
  r('DELETE', '/views/{view}/favorite', 'memberPlus', 204, { needs: ['view'] }),
  r('GET', '/search', 'everyone', 200, { query: 'q=seed' }),
  r('GET', '/search/recents', 'everyone', 200),
  r('POST', '/search/recents', 'everyone', 201, { body: () => ({ kind: 'query', query: 'q' + Math.random().toString(36).slice(2, 8) }), note: 'kind=query; a guest gets 403 for kind=project' }),
  r('DELETE', '/search/recents', 'everyone', 204),
  r('DELETE', '/search/recents/{recent}', 'everyone', 204, { note: 'idempotent: an unknown or foreign id is 204 too' }),
  r('GET', '/sync', 'everyone', 200, { stream: true }),
  r('GET', '/events', 'everyone', 200, { stream: true }),
  r('POST', '/presence', 'issueRead', 200, { needs: ['issue'], body: (t) => ({ issue_id: t.issue }) }),
  r('DELETE', '/presence', 'issueRead', 200, { needs: ['issue'], body: (t) => ({ issue_id: t.issue }) }),
  // ---- notifications (a caller's own, whatever the role)
  r('GET', '/notifications', 'everyone', 200),
  r('GET', '/notifications/unread-count', 'everyone', 200),
  r('POST', '/notifications/read-all', 'everyone', 200),
  r('POST', '/notifications/archive-read', 'everyone', 200),
  r('POST', '/notifications/bulk', ['noop', 'noop', 'ok', 'noop', 'noop', 'noop'], 200, { needs: ['notif'], body: (t) => ({ ids: [t.notif], action: 'read' }) }),
  r('GET', '/notification-preferences', 'everyone', 200),
  r('PUT', '/notification-preferences', 'everyone', 200, { body: () => ({ preferences: {} }) }),
  r('GET', '/notifications/{notif}', 'mineOnly', 200, { needs: ['notif'] }),
  r('DELETE', '/notifications/{notif}', 'mineOnly', 204, { needs: ['notif'] }),
  r('POST', '/notifications/{notif}/read', 'mineOnly', 200, { needs: ['notif'] }),
  r('POST', '/notifications/{notif}/unread', 'mineOnly', 200, { needs: ['notif'] }),
  r('POST', '/notifications/{notif}/archive', 'mineOnly', 200, { needs: ['notif'] }),
  r('POST', '/notifications/{notif}/unarchive', 'mineOnly', 200, { needs: ['notif'] }),
  r('POST', '/notifications/{notif}/snooze', 'mineOnly', 200, { needs: ['notif'], body: () => ({ until: new Date(Date.now() + 30 * 86400000).toISOString() }) }),
];

const SIX_IDX = { owner: 0, admin: 1, member: 2, outsideTeam: 3, guestShared: 4, guestUnshared: 5 } as const;
export function expected(row: Row, role: RoleName): Exp {
  const six = typeof row.policy === 'string' ? (POLICIES as Record<string, Six>)[row.policy]! : row.policy;
  if (row.over?.[role] !== undefined) return row.over[role]!;
  if (role === 'anon') return 401;
  if (role === 'otherWs') return 404;
  if (role === 'roKey') return row.sessionOnly || row.m !== 'GET' ? 403 : six[SIX_IDX.member];
  return six[SIX_IDX[role]];
}
export const rowId = (r: Row) => `${r.m} ${r.path}${r.variant ? ` (${r.variant})` : ''}`;
export { ROLES };

/**
 * Routes outside /w/{slug}: authenticated-user routes (session cookie only; a bearer API key is 401) and public routes.
 * `auth` = status per caller class: session (any signed-in user, whatever their workspace role), key (any API key), anon.
 */
export type GlobalRow = { m: Method; path: string; kind: 'session' | 'public' | 'signed'; session?: number; key?: number; anon?: number; body?: unknown; note: string };
export const GLOBAL_ROWS: GlobalRow[] = [
  { m: 'GET', path: '/api/v1/me', kind: 'session', session: 200, key: 401, anon: 401, note: 'own profile; no id in the path' },
  { m: 'PATCH', path: '/api/v1/me', kind: 'session', session: 200, key: 401, anon: 401, body: { display_name: 'Fixture' }, note: 'own profile only' },
  { m: 'GET', path: '/api/v1/workspaces', kind: 'session', session: 200, key: 401, anon: 401, note: 'only the workspaces the caller belongs to' },
  { m: 'POST', path: '/api/v1/workspaces', kind: 'session', session: 422, key: 401, anon: 401, body: {}, note: 'any signed-in user may create a workspace (422 here: empty body)' },
  { m: 'POST', path: '/api/v1/invites/accept', kind: 'session', session: 404, key: 401, anon: 401, body: {}, note: 'an unknown or empty token is 404; the caller must be signed in' },
  { m: 'POST', path: '/api/v1/auth/login', kind: 'public', note: 'public, rate limited; own suite m1-auth / t4-authn' },
  { m: 'POST', path: '/api/v1/auth/signup', kind: 'public', note: 'public, rate limited; own suite m1-auth / t4-authn' },
  { m: 'POST', path: '/api/v1/auth/verify-email', kind: 'public', note: 'public, one-time token' },
  { m: 'POST', path: '/api/v1/auth/password-reset/request', kind: 'public', note: 'public, no account oracle' },
  { m: 'POST', path: '/api/v1/auth/password-reset/confirm', kind: 'public', note: 'public, one-time token' },
  { m: 'POST', path: '/api/v1/auth/logout', kind: 'public', note: 'ends the caller own session; harmless without one' },
  { m: 'POST', path: '/api/v1/auth/logout-all', kind: 'public', note: 'ends all sessions of the caller; harmless without one' },
  { m: 'POST', path: '/api/v1/integrations/github/webhook/{connectionId}', kind: 'signed', note: 'authenticated by the HMAC signature of the connection secret; suite a9-github' },
];
export const normPath = (p: string) => p.replace(/\{[A-Za-z0-9]+\}|\[[A-Za-z0-9]+\]/g, '{}');
