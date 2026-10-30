# Authorization matrix

Generated from `tests/authz/matrix.ts` (do not edit by hand: `UPDATE_AUTHZ_DOC=1 pnpm vitest run tests/integration/a3-authz-doc.test.ts`).
`tests/integration/a3-authz-matrix.test.ts` executes every cell below against a running app with real resources created per cell, and checks that every refused call leaves the workspace data unchanged.

## Reading the table

- Cells are HTTP statuses. A 2xx is the success status of the route; `200*` = answered with success but per-item results, nothing may change (bulk on ids the caller cannot see).
- Roles: **owner** = owner; **admin** = admin; **member** = member (in team); **outsideTeam** = member (outside team); **guestShared** = guest (shared); **guestUnshared** = guest (not shared); **anon** = unauthenticated; **roKey** = read-only API key (member); **otherWs** = user of another workspace.
- "member (in team)" is a member of the team that owns the fixture resource; "member (outside team)" is a workspace member of no team. The read-only API key belongs to the in-team member.
- A shared guest holds an active share on the fixture issue; an unshared guest has none.

## Rules

1. Unauthenticated: 401 everywhere. A user of another workspace: 404 everywhere (workspace slugs are not enumerable).
2. A **read-only API key** acts as its owner for GET and is refused 403 on every other method; key and webhook management is session-only (403 for any key).
3. **Role gate before lookup**: a route that needs a minimum role answers 403 to a lower role whether or not the id exists (no oracle). Where the route looks the resource up first, a resource the caller cannot see is **404, never 403**.
4. A body or query field that names a team the caller cannot see is refused **422** exactly like an unknown team (no existence oracle); a path id of a hidden team is 404.
5. Lists are filtered by visibility: they answer 200 with an empty page to a role that sees nothing (projects for guests); item routes of the same resource answer 404.
6. Guests: read-only on what is shared with them; no member list, labels, projects, cycles, views or webhooks; they may mint **read-scope API keys only** (any other scope is 403, Meg rule 2026-10-30).
7. Workspace-scope label groups and label deletion, cycles, webhooks, invites, audit, workspace settings, team creation and deletion are admin+ (owner and admin behave the same except member management: only an owner may promote to or demote an owner/admin, see `mayManage` in `tenancy.ts`).

## Workspace routes (`/api/v1/w/{slug}`)

| Route | owner | admin | member | outsideTeam | guestShared | guestUnshared | anon | roKey | otherWs |
|---|---|---|---|---|---|---|---|---|---|
| `GET /` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `GET /settings` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `PATCH /settings` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /members` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /members/{target}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /members/{target}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /audit` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /invites` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /invites` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /invites/{invite}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /invites/{invite}/resend` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /api-keys` (session only) | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 403 | 404 |
| `POST /api-keys (scope=read)` (session only) | 201 | 201 | 201 | 201 | 201 | 201 | 401 | 403 | 404 |
| `POST /api-keys (scope=write)` (session only) | 201 | 201 | 201 | 201 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /api-keys/{apikey}` (session only) | 204 | 204 | 204 | 404 | 404 | 404 | 401 | 403 | 404 |
| `GET /webhooks` (session only) | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /webhooks` (session only) | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /webhooks/{webhook}` (session only) | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `PATCH /webhooks/{webhook}` (session only) | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /webhooks/{webhook}` (session only) | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /webhooks/{webhook}/deliveries` (session only) | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /webhooks/{webhook}/deliveries/{delivery}/redeliver` (session only) | 202 | 202 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /integrations/github` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `PUT /integrations/github` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /integrations/github` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /integrations/github/links` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `GET /integrations/github/teams/{team}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `PUT /integrations/github/teams/{team}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /teams` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `PATCH /teams/{team}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /teams/{team}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/members` | 200 | 200 | 200 | 200 | 404 | 404 | 401 | 200 | 404 |
| `POST /teams/{team}/members/{target}` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `PATCH /teams/{team}/members/{memberId}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /teams/{team}/members/{target}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/settings` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `PATCH /teams/{team}/settings` | 200 | 200 | 403 | 404 | 404 | 404 | 401 | 403 | 404 |
| `GET /teams/{team}/cycle-settings` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `PUT /teams/{team}/cycle-settings` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /teams/{team}/cycles/ensure` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/states` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `POST /teams/{team}/states` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/states/{state}` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `PATCH /teams/{team}/states/{state}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /teams/{team}/states/{state}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/templates` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `POST /teams/{team}/templates` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /teams/{team}/templates/{template}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /teams/{team}/templates/{template}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /teams/{team}/templates/{template}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /issues` | 201 | 201 | 201 | 422 | 403 | 403 | 401 | 403 | 404 |
| `POST /issues/bulk` | 200 | 200 | 200 | 200* | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `PATCH /issues/{issue}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /issues/{issue}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/activity` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /issues/{issue}/archive` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `POST /issues/{issue}/unarchive` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `POST /issues/{trashed}/restore` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/children` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `GET /issues/{issue}/attachments` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /issues/{issue}/attachments` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /issues/{issue}/attachments/{attachment}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `POST /issues/{issue}/attachments/uploads` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/attachments/{attachment}/content` | 404 | 404 | 404 | 404 | 404 | 404 | 401 | 404 | 404 |
| `PUT /issues/{issue}/attachments/{attachment}/content` | 404 | 404 | 404 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/comments` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /issues/{issue}/comments` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/relations` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /issues/{issue}/relations` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /issues/{issue}/relations/{relation}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/shares` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `POST /issues/{issue}/shares` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /issues/{issue}/shares/{guestId}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/subscription` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `PUT /issues/{issue}/subscription` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 403 | 404 |
| `DELETE /issues/{issue}/subscription` | 204 | 204 | 204 | 404 | 204 | 404 | 401 | 403 | 404 |
| `GET /subscriptions` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `PUT /subscriptions/{kind}/{project}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /subscriptions/{kind}/{project}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /issues/{issue}/presence` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /issues/{issue}/presence` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 403 | 404 |
| `DELETE /issues/{issue}/presence` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 403 | 404 |
| `GET /comments/{comment}` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `PATCH /comments/{comment}` | 403 | 403 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /comments/{comment}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `POST /comments/{comment}/resolve` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `POST /comments/{comment}/unresolve` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /comments/{comment}/reactions` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 200 | 404 |
| `POST /comments/{comment}/reactions` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /comments/{comment}/reactions` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /labels` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `POST /labels` | 201 | 201 | 201 | 201 | 403 | 403 | 401 | 403 | 404 |
| `GET /labels/{label}` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /labels/{label}` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /labels/{label}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /label-groups` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `POST /label-groups` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /label-groups/{group}` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /label-groups/{group}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /label-groups/{group}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /projects` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /projects` | 201 | 201 | 201 | 422 | 403 | 403 | 401 | 403 | 404 |
| `GET /projects/{project}` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `PATCH /projects/{project}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /projects/{project}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /projects/{project}/milestones` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `POST /projects/{project}/milestones` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /project-milestones/{milestone}` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `PATCH /project-milestones/{milestone}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /project-milestones/{milestone}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /projects/{project}/updates` | 200 | 200 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `POST /projects/{project}/updates` | 201 | 201 | 201 | 404 | 403 | 403 | 401 | 403 | 404 |
| `PATCH /project-updates/{update}` | 403 | 403 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /project-updates/{update}` | 204 | 204 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /cycles` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `POST /cycles` | 201 | 201 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /cycles/{cycle}` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /cycles/{cycle}` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /cycles/{cycle}` | 204 | 204 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /cycles/{cycle}/burndown` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `GET /cycles/{cycle}/stats` | 200 | 200 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `POST /cycles/{cycle}/complete` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `POST /cycles/snapshot` | 200 | 200 | 403 | 403 | 403 | 403 | 401 | 403 | 404 |
| `GET /cycles/window` | 200 | 200 | 200 | 422 | 403 | 403 | 401 | 200 | 404 |
| `GET /views` | 200 | 200 | 200 | 200 | 403 | 403 | 401 | 200 | 404 |
| `POST /views` | 201 | 201 | 201 | 201 | 403 | 403 | 401 | 403 | 404 |
| `GET /views/{view}` | 404 | 404 | 200 | 404 | 403 | 403 | 401 | 200 | 404 |
| `PATCH /views/{view}` | 404 | 404 | 200 | 404 | 403 | 403 | 401 | 403 | 404 |
| `DELETE /views/{view}` | 404 | 404 | 204 | 404 | 403 | 403 | 401 | 403 | 404 |
| `GET /search` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `GET /search/recents` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /search/recents` | 201 | 201 | 201 | 201 | 201 | 201 | 401 | 403 | 404 |
| `DELETE /search/recents` | 204 | 204 | 204 | 204 | 204 | 204 | 401 | 403 | 404 |
| `DELETE /search/recents/{recent}` | 204 | 204 | 204 | 204 | 204 | 204 | 401 | 403 | 404 |
| `GET /sync` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `GET /events` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /presence` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 403 | 404 |
| `DELETE /presence` | 200 | 200 | 200 | 404 | 200 | 404 | 401 | 403 | 404 |
| `GET /notifications` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `GET /notifications/unread-count` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `POST /notifications/read-all` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 403 | 404 |
| `POST /notifications/archive-read` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 403 | 404 |
| `POST /notifications/bulk` | 200* | 200* | 200 | 200* | 200* | 200* | 401 | 403 | 404 |
| `GET /notification-preferences` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 200 | 404 |
| `PUT /notification-preferences` | 200 | 200 | 200 | 200 | 200 | 200 | 401 | 403 | 404 |
| `GET /notifications/{notif}` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 200 | 404 |
| `DELETE /notifications/{notif}` | 404 | 404 | 204 | 404 | 404 | 404 | 401 | 403 | 404 |
| `POST /notifications/{notif}/read` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 403 | 404 |
| `POST /notifications/{notif}/unread` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 403 | 404 |
| `POST /notifications/{notif}/archive` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 403 | 404 |
| `POST /notifications/{notif}/unarchive` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 403 | 404 |
| `POST /notifications/{notif}/snooze` | 404 | 404 | 200 | 404 | 404 | 404 | 401 | 403 | 404 |

## Routes outside a workspace

| Route | Kind | Signed-in user | API key | Anonymous | Note |
|---|---|---|---|---|---|
| `GET /api/v1/me` | session | 200 | 401 | 401 | own profile; no id in the path |
| `PATCH /api/v1/me` | session | 200 | 401 | 401 | own profile only |
| `GET /api/v1/workspaces` | session | 200 | 401 | 401 | only the workspaces the caller belongs to |
| `POST /api/v1/workspaces` | session | 422 | 401 | 401 | any signed-in user may create a workspace (422 here: empty body) |
| `POST /api/v1/invites/accept` | session | 404 | 401 | 401 | an unknown or empty token is 404; the caller must be signed in |
| `POST /api/v1/auth/login` | public | - | - | - | public, rate limited; own suite m1-auth / t4-authn |
| `POST /api/v1/auth/signup` | public | - | - | - | public, rate limited; own suite m1-auth / t4-authn |
| `POST /api/v1/auth/verify-email` | public | - | - | - | public, one-time token |
| `POST /api/v1/auth/password-reset/request` | public | - | - | - | public, no account oracle |
| `POST /api/v1/auth/password-reset/confirm` | public | - | - | - | public, one-time token |
| `POST /api/v1/auth/logout` | public | - | - | - | ends the caller own session; harmless without one |
| `POST /api/v1/auth/logout-all` | public | - | - | - | ends all sessions of the caller; harmless without one |
| `POST /api/v1/integrations/github/webhook/{connectionId}` | signed | - | - | - | authenticated by the HMAC signature of the connection secret; suite a9-github |
