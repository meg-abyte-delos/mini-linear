# Mini-Linear public API

Base URL: `https://<host>/api/v1/w/<workspace-slug>/...`. JSON in, JSON out. Errors: `{ "error": { "code", "message", "request_id", "details?" } }` (also `x-request-id`).

## Authentication: personal API keys

Create a key in a signed-in session: `POST /api/v1/w/<slug>/api-keys` `{ "name": "CI bot", "scope": "read" | "write", "expires_in_days"?: 1..3650 }`.
The response carries `token` (`mlk_<prefix>_<secret>`) **once**; only its sha256 is stored. The 8-char `prefix` is shown in listings.
**Guests** may only create `read`-scope keys. `scope` defaults to `write`, so omitting it returns 403 (`forbidden`); send `"scope": "read"` explicitly.

Call the API with `Authorization: Bearer mlk_...`.

- A key opens **only its own workspace** (other slugs: 404) and acts with the owner's **current** role and team memberships (RLS + the same visibility rules as the UI). Demoting or removing the owner restricts or kills the key immediately.
- `read` keys: GET/HEAD only (403 otherwise). `write` keys: everything the owner may do, except managing keys and webhooks (session-only, 403).
- Unknown, malformed, revoked or expired key: 401. No CSRF origin check for bearer calls (not an ambient credential).
- Rate limit: `API_KEY_RATE_LIMIT` requests per minute per key (default 600), shared across instances (Postgres fixed window); over it: 429 `rate_limited`.
- Max 25 active keys per user. `GET /api-keys` lists yours (`?all=1` for admins: every key). `DELETE /api-keys/<id>` revokes (owner, or any admin).

## Resources

Same endpoints as the app, so the API is always at parity:

| Resource | Endpoints |
|---|---|
| Issues | `GET/POST /issues`, `GET/PATCH/DELETE /issues/<id>`, `POST /issues/<id>/restore` |
| Comments | `GET/POST /issues/<id>/comments`, `PATCH/DELETE /comments/<id>` |
| Attachments | `GET/POST /issues/<id>/attachments` (links), `DELETE /issues/<id>/attachments/<aid>`, file uploads below |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/<id>` (field `priority`: 0 none, 1 urgent .. 4 low, default 0) |
| Teams | `GET/POST /teams`, `GET/PATCH/DELETE /teams/<id>`, `/teams/<id>/members` |
| Saved views | `GET/POST /views`, `GET/PATCH/DELETE /views/<id>` (PATCH/DELETE need `If-Match`) |
| View state | `GET/PUT/DELETE /view-state` per user and scope |
| Favourite views | `GET /views/favorites`, `PUT/DELETE /views/<id>/favorite` |
| Also | `/cycles`, `/labels`, `/members`, `/audit` |

### View state and favourite views (A5, member+; guests get 403)

- `scope`: `all`, `my-issues`, `team:<uuid>`, `project:<uuid>`, `cycle:<uuid>`, `view:<uuid>`; anything else is 422. A team/project/cycle/view scope the caller cannot see is 404.
- `GET /view-state?scope=S` returns `{ scope, layout, filters, display, version, updated_at }`; with nothing stored it is 200 with defaults (`layout: "list"`, `filters: {op:"and",rules:[]}`, `display: {}`, `version: 0`). Without `scope`: `{ items: [...] }` (yours only, max 100).
- `PUT /view-state` body `{ scope, layout, filters, display }` (strict; same `filters`/`display` schemas as `/views`; filters max 32 KB, display max 8 KB, else 422), header `If-Match: <version>` (`0` to create). 200 with the new row; 412 stale, 428 missing header. Ids inside filters are not validated.
- `DELETE /view-state?scope=S` resets to defaults: 204, idempotent. `scope` is required (422).
- `GET /views/favorites` returns `{ items: [{ view_id, position, view }] }` ordered by position; views no longer visible to the caller are omitted.
- `PUT /views/<id>/favorite` body `{ position?: int >= 0 }` (default: end) returns 200 `{ view_id, position }`, idempotent; 404 if the view is not visible; the 51st favourite is 422. `DELETE /views/<id>/favorite`: 204, idempotent.
- State and favourites are personal (RLS `own_rows`: even admins cannot read another user's rows) and not audited.

**Pagination**: `?limit=1..100` (default 50) and `?cursor=<next_cursor>`; responses are `{ "items": [...], "next_cursor": string | null }`. Cursors are signed and bound to the workspace and list.
**Concurrency**: PATCH needs `If-Match: <version>` (the `ETag` of the GET); missing: 428, stale: 412.

```sh
curl -H "Authorization: Bearer $ML_KEY" https://ml.example.com/api/v1/w/acme/issues?limit=20
```

A GraphQL endpoint is not provided (out of scope for this iteration).

## File attachments

1. `POST /issues/<id>/attachments/uploads` body `{ "filename", "mime_type", "size_bytes", "title"? }` (member+, strict). Reserves a `pending` row: `201 { id, upload_url, expires_at }` (expires after 1 h).
2. `PUT <upload_url>` with the raw bytes, `Content-Type` = declared mime (parameters ignored), `Content-Length` = declared size. Only the creator, once. The server counts the bytes while streaming (never trusts `Content-Length`/chunked framing), hashes them (sha256), checks the first bytes against the mime (png, jpeg, gif, webp, pdf, zip and office types) and flips the row to `ready`: `200` with the attachment DTO. Errors: 422 wrong length (partial bytes are deleted, the row stays pending and can be retried), 415 wrong type or magic bytes, 403 other user, 409 already uploaded, 404 expired.
3. `GET <upload_url>` streams the bytes (single `Range` supported: 206, or 416). Headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, max-age=0`, `Content-Disposition: attachment` with RFC 5987 `filename*` and a sanitised ASCII fallback. `?inline=1` is honoured only for png/jpeg/gif/webp.

DTO: `id, issue_id, kind, url (null for uploads), title, mime_type, size_bytes, filename, upload_status (pending|ready), sha256, download_url (null for links and pending), created_by, created_at`. Lists show `ready` rows (the creator also sees their own pending ones); deleted rows are excluded.

Limits: 25 MB per file (`ATTACHMENT_MAX_BYTES`, declared size above it is `413 payload_too_large` at step 1), 200 MB per workspace (`ATTACHMENT_WORKSPACE_QUOTA`, 422 `workspace attachment quota exceeded`, checked under an advisory lock, counts ready + pending), 20 pending per user, 500 per issue. Allowlist: png, jpeg, gif, webp, pdf, text/plain, text/markdown, text/csv, zip, json, docx, xlsx, pptx; anything else (svg and html included) is `415 unsupported_media_type`.

Rights: list/download follow the issue's visibility (other-team member 404, guest with an active share can download); upload needs member+ (guest 403); delete by the uploader or admin+. DELETE is soft; a GC job (every 5 min, also at boot) removes pending rows older than 1 h and deleted rows older than 10 min with their bytes, plus stored keys no row references any more. Storage: `ATTACHMENTS_DIR` (default `./.data/attachments`) behind the `AttachmentStore` interface (`put/get/delete/list`). Migration: 0805. Content check: only the binary types above are verified against their signature; `text/plain`, `text/markdown`, `text/csv` and `application/json` have no content check (they are served as `attachment` with `nosniff` and `CSP: sandbox`). The PUT holds no database transaction while the body streams: it claims the row (`uploading`, internal; exposed as `pending`), streams to the store with an idle timeout (30 s, `ATTACHMENT_IDLE_TIMEOUT_MS`) and a total timeout (10 min), at most 8 PUTs per process (`ATTACHMENT_MAX_CONCURRENT_PUTS`) and 2 per user (`ATTACHMENT_MAX_CONCURRENT_PUTS_PER_USER`), else 429, then finalizes in a short transaction; a failed transfer deletes the partial bytes and returns the row to `pending`. GC also reclaims `uploading` rows stuck for 15 min (longer than the 10 min total upload timeout). The orphan-key and temp-file sweep runs hourly (bounded to 50 000 keys per pass, resuming from a cursor so the whole store is covered over several passes). A successful upload or a delete emits an `issue` update event on the parent (see Notes in the lane report).

## Notifications and realtime (A6)

| Endpoint | Notes |
|---|---|
| `GET /notifications` | items add `coalesced_count`, `last_event_at`, `meta` (`{from,to}` for `status_change`, `{child_id}` for `sub_issue`, `{reason:"followed_<kind>"}`, `{relation_type,related_issue_id}`, `{due_date}`); reply carries `unread_count` |
| `GET /notifications` (kind) | every item carries `kind`: `"system"` when it has no actor (`actor_id` and `actor` are null, always the case for `due_soon`), `"user"` otherwise. A client renders a system item as "Due soon", never as "Someone"; `status` stays the raw enum (the UI formats it) |
| `POST /notifications/bulk` | `{ids (1..100), action: read\|unread\|archive\|unarchive}` strict. `200 { updated, results:[{id,status:"ok"\|"not_found"}], unread_count }`. Foreign, hidden and unknown ids are `not_found`, never an error |
| `GET /subscriptions?kind=project\|cycle\|team\|label` | caller's own entity subscriptions `{ items:[{kind,entity_id,created_at}] }`. Guests: 403, bad kind: 422 |
| `PUT/DELETE /subscriptions/<kind>/<entityId>` | 204, idempotent. Unknown or invisible entity (for a project: not visible to the caller, same rule as `GET /projects/:id`): 404 on PUT and, for projects, on DELETE; entityId not a uuid: 422, more than 200: 422 |
| `/notification-preferences` | now 8 types: assigned, mention, comment, status_change, due_soon, reply, sub_issue, relation |

Types: a reply in a thread you wrote or follow is `reply`; a child added to an issue you follow is `sub_issue`; a relation involving an issue you follow is `relation`. An unread notification of the same `(user, issue, type)` is updated instead of duplicated (`coalesced_count`, `last_event_at`); `mention` and `assigned` never coalesce, a read or archived one is never reused. Issues created in or moved into a followed project/cycle/team, or labelled with a followed label, notify as `sub_issue` with `meta.reason`.

`meta.child_id` and `meta.related_issue_id` are NOT visibility-checked for the recipient: a client must resolve them through the authorised issue GET (404 means hidden) and never render a title from them directly. `POST /notifications/read-all` and `archive-read` touch at most 500 rows per call (`updated` equal to 500 means call again).

`due_soon` is produced by the internal cron route `POST /api/internal/notifications/due-soon` (header `x-cron-secret` = env `CRON_SECRET`, constant-time compare; unset env: 503; wrong or missing header: 401). It is not part of the public API.

**Change feed** (`GET /sync?after=`, SSE `GET /events`, `Last-Event-ID` replay and `resync` unchanged). Events are `{ id (sealed cursor), entity, entity_id, op, version, issue_id|null, scope? , unread_count? }`, SSE event name `<entity>.<op>`. Entities: issue, comment, relation, attachment, label, project, cycle, view, notification, view_state, favorite. Per-user events (`notification`, `view_state`, `favorite`) reach their user only; `notification` events carry the current `unread_count`; events with `issue_id: null` (project, cycle, label, view) are workspace wide and not sent to guests. A child issue created, deleted, restored, re-parented or changing status/estimate also emits an `issue.update` for its parent(s). Lanes emit through `emitSync()` (`src/lib/sync/emit.ts`) or the SQL function `sync_publish()`.

## Outbound webhooks

Workspace admins, signed-in session only.

- `POST /webhooks` `{ "url", "events": [...], "active"?: true }` returns the `secret` (`whsec_...`) **once**. Max 20 per workspace.
- `GET /webhooks`, `GET/PATCH/DELETE /webhooks/<id>`.
- `GET /webhooks/<id>/deliveries?status=pending|succeeded|failed` (delivery log, newest first, paginated), `POST /webhooks/<id>/deliveries/<deliveryId>/redeliver` (202).

Events: `issue.created|updated|deleted` (soft delete counts as `deleted`), `comment.created|updated|deleted`, `project.created|updated|deleted`.
They are enqueued by DB triggers **in the same transaction** as the change (rolled back with it, never lost), then sent by a background dispatcher (`WEBHOOKS_DISABLED=1` turns it off).

Request: `POST <url>`, JSON body `{ "id": <delivery id>, "event", "workspace_id", "occurred_at", "data": <row> }`, headers:

- `X-MiniLinear-Event`, `X-MiniLinear-Delivery` (idempotency key),
- `X-MiniLinear-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Verify it and reject timestamps older than 5 minutes.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
const ok = Math.abs(Date.now() / 1000 - +t) < 300 &&
  timingSafeEqual(Buffer.from(v1, "hex"), createHmac("sha256", secret).update(`${t}.${rawBody}`).digest());
```

Delivery: 2xx = success (redirects are not followed). Otherwise retried with backoff `30s * 2^(n-1)` (max 6h), 8 attempts, then `failed`. Timeout 10s. Multiple app instances are safe (`FOR UPDATE SKIP LOCKED` lease).

**SSRF**: URLs must be https (port 443 or above 1024), without credentials; the trailing dot is stripped (`localhost.`), and `localhost`, `.internal`/`.local`, literal private/reserved IPs (incl. 192.0.0.0/24, 198.18.0.0/15, 224.0.0.0/4, 64:ff9b::/96, 2002::/16) are refused at registration. At send time the dispatcher resolves the name (`dns.lookup`, all addresses), rejects the delivery if ANY address is private/reserved, and connects to the validated IP (pinned lookup), which blocks DNS rebinding and nip.io-style names. `ML_WEBHOOKS_ALLOW_PRIVATE=1` disables these checks (dev/CI only).

**Secrets and dispatcher role**: the app role cannot read `webhooks.secret` (column grants). Delivery runs as the `webhook_dispatcher` role; set `WEBHOOK_DISPATCHER_DATABASE_URL` to a LOGIN role that is a member of it (without it, the app pool uses `SET LOCAL ROLE`, dev/CI). `complete_webhook_delivery` checks the workspace. Migration: 0111.

**Scopes**: `read`, `write`, `admin`; creating a key above your own role is refused. Invalid keys are rate limited per IP (`API_BAD_KEY_LIMIT`, default 30/min); a non-Bearer Authorization header gets 401 (no cookie fallback).

**Payload / retention**: `payload` is the row as JSON (`to_jsonb(row)`) minus the internal `tsv` column. Deliveries older than 30 days are purged by the dispatcher (`purge_webhook_deliveries`).

## Sub-issues, relations, estimates (A4, migration 0801)

Contract: `docs/contracts/A4-subissues-relations-estimates.md`. All routes under `/api/v1/w/<slug>`.

- **Issue DTO** (single and list): `sub_issues: { total, done, in_progress }` (direct, non-deleted children; `in_progress` = state category `started`), `estimate_rollup: { own, children, total }` (`children` = sum of the non-null child estimates, null when none; `total = (own ?? 0) + (children ?? 0)`), `parent: { id, identifier, title } | null`.
- **Parent rules** (POST and PATCH `parent_id`): the parent must be a live issue the caller sees and must be in the child's team, else 422 `validation_failed` (unknown, foreign, soft-deleted and hidden parents share one message; team mismatch: "sub-issue must be in the parent's team"). Cycles and depth > 5 are 422 (DB trigger). `team_id` is not patchable (strict body, 422), so a parent or child cannot be moved out of its team.
- `GET /issues?parent_id=<uuid>|none` (`none` = top-level only).
- `GET /issues/:id/sub-issues?limit&cursor&include=children|descendants`: issue DTOs ordered `(sort_key, id)`; `descendants` flattens the visible subtree with `depth` 1..4. 404 when the parent is not visible. The older `GET /issues/:id/children` (no pagination, max 500) stays.
- **Reorder**: `PATCH /issues/:id { move: { before_id } | { after_id } }` (If-Match as usual). The target must be another issue with the same parent, else 422. Only `sort_key` and `version` change (not audited).
- **Relations**: items and the POST 201 body carry `related_issue { id, identifier, title, status, priority, assignee_id, team_id }`. Duplicate pair: 409 `conflict` with `details { relation_id, type }` (type as seen from the requested issue). `POST` accepts `cancel_source` (boolean). **Deviation from the contract text**: default `true`, because main already cancels the source on `duplicate` (test `a1-relations`); `false` skips it.
- **Bulk** `POST /issues/bulk` (existing, max 250 ids): patch gains `estimate` (validated against the team scale, per issue) and `add_label_ids` / `remove_label_ids` (aliases of `label_ids_add` / `label_ids_remove`); optional `versions: { <issue_id>: <version> }` is a per-issue If-Match (stale: that id fails with `precondition_failed`, `details.current_version`). Failed items may carry `details`. Actions `delete` / `restore` / `archive` / `unarchive` bump versions; team-guests fail per issue with `forbidden`.
- `GET /teams/:id/estimate-scale` -> `{ scale, allow_zero, values }` (`values` empty for `none`). Admin+ always; other callers must be team members (404 otherwise); guests 403.
## Search (A7)

`GET /api/v1/w/:slug/search?q&kind&...` full-text search (config `simple`, prefix match on the last token, websearch syntax; `DEM-12` ranks that issue first).
- `q` trimmed 1..200 chars, no NUL byte: otherwise 422 `validation_failed`. Any text param containing NUL is 422, never 500.
- `kind` comma list of `issue|comment|project|attachment` (default `issue,comment,project`; unknown: 422). Attachment hits: title match, visibility of the issue, only rows that are not soft-deleted and `upload_status = ready` (links count as ready).
- Filters: `status`, `team_id`, `assignee_id`, `project_id`, `label_id`, `priority` (0..4), `cycle_id`, `state_id`, `due_before`, `due_after` (YYYY-MM-DD), `has_attachment`, `include_done` (default true). Any issue-only filter drops projects. Bad enum / uuid / date / bool: 422.
- `sort=rank` (default, `rank desc, id`) or `sort=updated` (`updated_at desc, id`); `limit` 1..100, `cursor` opaque. A cursor from the other sort, or a garbled one: 400 `bad_request`.
- Item: `{ kind, id, issue_id, identifier, title, snippet, rank, status, team_id, project_id, assignee_id, updated_at, parent_identifier, matched }`. `snippet` is HTML-escaped; only `<mark>`/`</mark>` are live tags (render as text + mark). `parent_identifier` is null unless the caller can see the parent. `matched` is a subset of `title|description|comment|attachment`.
- Visibility: owner/admin all; member their teams; guest only shared issues (no projects). Rate limit 120 requests/min per user: 429 `rate_limited` with `Retry-After` (seconds; override `SEARCH_RATE_LIMIT`).

`GET /search/recents` -> `{ items: [{ id, kind: query|issue|project, query, entity_id, created_at }] }` newest first, max 20, entities no longer visible dropped.
`POST /search/recents` strict body `{ kind, query? | entity_id? }` (`query` iff `kind=query`, else visible `entity_id`): 201; 422 bad body, 404 entity not visible, 403 guest + `project`. Re-adding the same query (case-insensitive) or entity moves it to the top; the 50 newest per user are kept.
`DELETE /search/recents` 204 clears; `DELETE /search/recents/:id` 204 idempotent (unknown/foreign id), 400 `bad_request` if the id is not a uuid. Any role incl. guest may clear or delete their own recents. Recents are per user (RLS `own_rows`).
## Project and cycle counters (A1)

One rule for every surface (API, project list, project page, roadmap rings, cycles list): **canceled issues are out of scope, soft-deleted issues do not exist.**

**Visibility**: counts only include issues the caller can see (team visibility). A member of team A looking at a project that spans A and B gets counts for A only; admins and owners get everything. The same member gets 404 on a cycle of a team they are not in, counts included. No count leaks the size of a hidden team.

`GET /projects` and `GET /projects/<id>` return (old names kept):

| Field | Meaning |
|---|---|
| `issues_total` (= `issue_count`) | visible, non-deleted, non-canceled issues |
| `issues_done` (= `done_count`) | status `done` |
| `issues_in_progress` | status `in_progress` or `in_review` |
| `issues_canceled` | status `canceled` (informational, not in the total) |
| `progress_pct` | `round(100 * done / total)`, 0 when empty |
| `progress_by_estimate` | `round(100 * done estimate / total estimate)` over non-canceled issues; `null` when no issue has an estimate |
| `health` | health of the latest posted project update, or `null` (always `null` while the project is `planned`) |
| `health_computed` | derived, see below |

`health_computed` is `on_track`, `at_risk`, `off_track` or `null`. `null` if the project is `planned`, `completed` or `canceled`, has no `target_date`, or has no issue. Else `on_track` at 100%; `off_track` when today is past `target_date`; otherwise `gap = elapsed% - progress_pct`, where `elapsed%` is the share of the window `start_date` (or creation day) to `target_date` already elapsed: gap up to 10 is on_track, up to 25 at_risk, else off_track. Pure function in `src/lib/project-health.ts`.

`GET /cycles` and `GET /cycles/<id>` also return `scope` (non-canceled), `started` (`in_progress` or `in_review`), `completed` (`done`), `canceled`, `percent_complete` (`round(100 * completed / scope)`, 0 when empty). Identical to `GET /cycles/<id>/stats`.

UI fix in the same change: the Cycles list ring counted canceled issues in the total and as done (4 issues with 1 canceled showed 50%); it now matches the API (33%).

## Changelog
- **Behavior change (A4):** `POST /issues/:id/relations` with `type: duplicate` now cancels the source issue by default (`cancel_source` defaults to `true`, was effectively false). Pass `{ "cancel_source": false }` to keep the previous behavior. Moving the source to the team's first `canceled` state happens in the same transaction.
