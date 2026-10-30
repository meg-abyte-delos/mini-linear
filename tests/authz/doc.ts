import { ROWS, GLOBAL_ROWS, expected, rowId } from './matrix';
import { ROLES, ROLE_LABEL, type Exp } from './roles';

const cell = (row: Parameters<typeof expected>[0], role: (typeof ROLES)[number]) => {
  const e: Exp = expected(row, role);
  return e === 'ok' ? String(row.ok) : e === 'noop' ? `${row.ok}*` : String(e);
};
/** docs/authz-matrix.md, generated from the same table the integration suite executes. */
export function renderMatrix(): string {
  const L: string[] = [];
  L.push('# Authorization matrix', '');
  L.push('Generated from `tests/authz/matrix.ts` (do not edit by hand: `UPDATE_AUTHZ_DOC=1 pnpm vitest run tests/integration/a3-authz-doc.test.ts`).');
  L.push('`tests/integration/a3-authz-matrix.test.ts` executes every cell below against a running app with real resources created per cell, and checks that every refused call leaves the workspace data unchanged.', '');
  L.push('## Reading the table', '');
  L.push('- Cells are HTTP statuses. A 2xx is the success status of the route; `200*` = answered with success but per-item results, nothing may change (bulk on ids the caller cannot see).');
  L.push('- Roles: ' + ROLES.map((r) => `**${r}** = ${ROLE_LABEL[r]}`).join('; ') + '.');
  L.push('- "member (in team)" is a member of the team that owns the fixture resource; "member (outside team)" is a workspace member of no team. The read-only API key belongs to the in-team member.');
  L.push('- A shared guest holds an active share on the fixture issue; an unshared guest has none.', '');
  L.push('## Rules', '');
  L.push('1. Unauthenticated: 401 everywhere. A user of another workspace: 404 everywhere (workspace slugs are not enumerable).');
  L.push('2. A **read-only API key** acts as its owner for GET and is refused 403 on every other method; key and webhook management is session-only (403 for any key).');
  L.push('3. **Role gate before lookup**: a route that needs a minimum role answers 403 to a lower role whether or not the id exists (no oracle). Where the route looks the resource up first, a resource the caller cannot see is **404, never 403**.');
  L.push('4. A body or query field that names a team the caller cannot see is refused **422** exactly like an unknown team (no existence oracle); a path id of a hidden team is 404.');
  L.push('5. Lists are filtered by visibility: they answer 200 with an empty page to a role that sees nothing (projects for guests); item routes of the same resource answer 404.');
  L.push('6. Guests: read-only on what is shared with them; no member list, labels, projects, cycles, views or webhooks; they may mint **read-scope API keys only** (any other scope is 403, Meg rule 2026-10-30).');
  L.push('7. Workspace-scope labels and label groups, cycles, webhooks, invites, audit, workspace settings, team creation and deletion are admin+ (owner and admin behave the same except member management: only an owner may promote to or demote an owner/admin, see `mayManage` in `tenancy.ts`).', '');
  L.push('## Workspace routes (`/api/v1/w/{slug}`)', '');
  L.push(`| Route | ${ROLES.join(' | ')} |`, `|---|${ROLES.map(() => '---').join('|')}|`);
  for (const r of ROWS) L.push(`| \`${rowId(r)}\`${r.sessionOnly ? ' (session only)' : ''} | ${ROLES.map((x) => cell(r, x)).join(' | ')} |`);
  L.push('', '## Routes outside a workspace', '');
  L.push('| Route | Kind | Signed-in user | API key | Anonymous | Note |', '|---|---|---|---|---|---|');
  for (const g of GLOBAL_ROWS) L.push(`| \`${g.m} ${g.path}\` | ${g.kind} | ${g.session ?? '-'} | ${g.key ?? '-'} | ${g.anon ?? '-'} | ${g.note} |`);
  L.push('');
  return L.join('\n');
}
