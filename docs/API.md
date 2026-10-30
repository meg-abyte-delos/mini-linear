# Mini-Linear public API

Base URL: `https://<host>/api/v1/w/<workspace-slug>/...`. JSON in, JSON out. Errors: `{ "error": { "code", "message", "request_id", "details?" } }` (also `x-request-id`).

## Authentication: personal API keys

Create a key in a signed-in session: `POST /api/v1/w/<slug>/api-keys` `{ "name": "CI bot", "scope": "read" | "write", "expires_in_days"?: 1..3650 }`.
The response carries `token` (`mlk_<prefix>_<secret>`) **once**; only its sha256 is stored. The 8-char `prefix` is shown in listings.

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
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/<id>` |
| Teams | `GET/POST /teams`, `GET/PATCH/DELETE /teams/<id>`, `/teams/<id>/members` |
| Also | `/cycles`, `/labels`, `/members`, `/audit` |

**Pagination**: `?limit=1..100` (default 50) and `?cursor=<next_cursor>`; responses are `{ "items": [...], "next_cursor": string | null }`. Cursors are signed and bound to the workspace and list.
**Concurrency**: PATCH needs `If-Match: <version>` (the `ETag` of the GET); missing: 428, stale: 412.

```sh
curl -H "Authorization: Bearer $ML_KEY" https://ml.example.com/api/v1/w/acme/issues?limit=20
```

A GraphQL endpoint is not provided (out of scope for this iteration).

## Notifications and realtime (A6)

| Endpoint | Notes |
|---|---|
| `GET /notifications` | items add `coalesced_count`, `last_event_at`, `meta` (`{from,to}` for `status_change`, `{child_id}` for `sub_issue`, `{reason:"followed_<kind>"}`, `{relation_type,related_issue_id}`, `{due_date}`); reply carries `unread_count` |
| `POST /notifications/bulk` | `{ids (1..100), action: read\|unread\|archive\|unarchive}` strict. `200 { updated, results:[{id,status:"ok"\|"not_found"}], unread_count }`. Foreign, hidden and unknown ids are `not_found`, never an error |
| `GET /subscriptions?kind=project\|cycle\|team\|label` | caller's own entity subscriptions `{ items:[{kind,entity_id,created_at}] }`. Guests: 403, bad kind: 422 |
| `PUT/DELETE /subscriptions/<kind>/<entityId>` | 204, idempotent. Unknown or invisible entity: 404, entityId not a uuid: 422, more than 200: 422 |
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
