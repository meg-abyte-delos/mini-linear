// Single source of truth for the authorization matrix: roles, expectation vocabulary and policy vectors.
// docs/authz-matrix.md is generated from this (tests/integration/a3-authz-doc.test.ts) and the table-driven
// suite tests/integration/a3-authz-matrix.test.ts executes every cell against a running app.
export const ROLES = ['owner', 'admin', 'member', 'outsideTeam', 'guestShared', 'guestUnshared', 'anon', 'roKey', 'otherWs'] as const;
export type RoleName = (typeof ROLES)[number];
export const ROLE_LABEL: Record<RoleName, string> = {
  owner: 'owner', admin: 'admin', member: 'member (in team)', outsideTeam: 'member (outside team)',
  guestShared: 'guest (shared)', guestUnshared: 'guest (not shared)', anon: 'unauthenticated', roKey: 'read-only API key (member)', otherWs: 'user of another workspace',
};
/** 'ok' = the success status of the row (2xx); a number = exact refusal status. */
/** 'noop' = answered with the success status but nothing may change (per-item results, e.g. bulk on hidden ids). */
export type Exp = 'ok' | 'noop' | 401 | 403 | 404 | 422;
/** The six cookie-session roles, in ROLES order: owner, admin, member, outsideTeam, guestShared, guestUnshared. */
export type Six = [Exp, Exp, Exp, Exp, Exp, Exp];
export const POLICIES = {
  // everyone who is a member of the workspace, guests included (their own data is filtered by RLS)
  everyone: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  // workspace-level content for members and above; guests have a role gate (403, independent of whether the id exists)
  memberPlus: ['ok', 'ok', 'ok', 'ok', 403, 403],
  adminOnly: ['ok', 'ok', 403, 403, 403, 403],
  ownerOnly: ['ok', 403, 403, 403, 403, 403],
  // team scoped reads: only people in the team (and admins) see it; everyone else gets 404
  teamRead: ['ok', 'ok', 'ok', 404, 404, 404],
  // team scoped admin actions: role gate first (403), then visibility
  teamAdmin: ['ok', 'ok', 403, 403, 403, 403],
  // issue-scoped (T1 issue shared with the shared guest)
  issueRead: ['ok', 'ok', 'ok', 404, 'ok', 404],
  issueWrite: ['ok', 'ok', 'ok', 404, 403, 403],
  // creating an issue needs a team you belong to (404 for a team you cannot see)
  issueCreate: ['ok', 'ok', 'ok', 422, 403, 403],
  // a body that names a team the caller cannot see is refused like an unknown team (422), never confirmed
  projectCreate: ['ok', 'ok', 'ok', 422, 403, 403],
  // a list filtered by visibility: 200 with an empty page for roles that see nothing
  filteredList: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  keyOwner: ['ok', 'ok', 'ok', 404, 404, 404],
  // saved views: own or shared only; guests are refused by the role gate
  viewOwn: [404, 404, 'ok', 404, 403, 403],
  bulk: ['ok', 'ok', 'ok', 'noop', 403, 403],
  // content of an issue that is authored by the member (comment edit, attachments of the member)
  authorOnly: [403, 403, 'ok', 404, 403, 403],
  authorOrAdmin: ['ok', 'ok', 'ok', 404, 403, 403],
  // data that belongs to the member alone (their notifications, their key)
  mineOnly: [404, 404, 'ok', 404, 404, 404],
  mineOrAdmin: ['ok', 'ok', 'ok', 403, 403, 403],
  // team project: visible to team members and admins
  // teams are listed for every non-guest (names, members); their content is not
  teamPublic: ['ok', 'ok', 'ok', 'ok', 404, 404],
  // team content behind a role gate (guests 403 before any lookup), hidden team 404 for outsiders
  teamRoleRead: ['ok', 'ok', 'ok', 404, 403, 403],
  // team admin action whose team lookup comes first: hidden team is 404 for outsiders and guests
  teamAdminHidden: ['ok', 'ok', 403, 404, 404, 404],
  projectWrite: ['ok', 'ok', 'ok', 404, 403, 403],
  // team cycle: team members and admins; guests are role-gated
  cycleRead: ['ok', 'ok', 'ok', 404, 403, 403],
  projectRead: ['ok', 'ok', 'ok', 404, 404, 404],
} satisfies Record<string, Six>;
export type PolicyName = keyof typeof POLICIES;
