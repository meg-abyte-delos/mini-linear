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
