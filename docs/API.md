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
