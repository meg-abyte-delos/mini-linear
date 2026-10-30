# A6: notification engine (mentions, assignment, subscriptions)

## Already on main
- `notifications` (0700): types `assigned|mention|comment|status_change|due_soon`; per-user RESTRICTIVE RLS; `notify(id, recipient, type, issue, comment)` SECURITY DEFINER (checks recipient is a member who can see the issue, not the actor, and has `in_app` for the type).
- Routes under `/notifications`: list, `unread-count`, `read-all`, `archive-read`, `:id` GET, `:id/read|unread|archive|unarchive|snooze` (snooze cap +1 year, else 422). `/notification-preferences` GET/PUT. `/issues/:id/subscription` (issue_subscribers + `muted` tombstone, 0701).
- Fan-out in `resources/notifications.ts`: followers + mentioned + new assignee, minus actor.

## Delta
### New event types
`reply` (a reply in a comment thread you wrote or follow), `sub_issue` (a child is added to an issue you follow), `relation` (a relation is created involving an issue you follow). Same `notify()`; they appear in `/notification-preferences` (default in_app true, email false).

### Producers (who notifies whom)
| Event | Recipients | Type |
|---|---|---|
| issue assigned / reassigned | new assignee | `assigned` |
| comment created | followers of the issue | `comment` |
| comment with `@mention` of a user | mentioned (unique per user+issue+comment) | `mention` |
| reply in a thread | thread author + followers | `reply` |
| status change | followers | `status_change` |
| child created or attached | followers of the parent | `sub_issue` |
| relation created | followers of both ends | `relation` |
| due date within 24h, not done | assignee, once per issue per due date | `due_soon` |
Followers = issue_subscribers not muted + creator + assignee (auto-subscribed on create, comment, mention, assignment). The actor never notifies self. `due_soon` is produced by `POST /internal/notifications/due-soon` (header `x-cron-secret`), idempotent; scheduling is infra's job. The secret comes from env `CRON_SECRET` and is compared in constant time (`crypto.timingSafeEqual` on equal-length digests). If the env var is unset or empty the route fails closed: 503 for the unset case, 401 for a wrong or missing header, never a pass-through. There is no user session, so the job lists workspaces and sets `app.workspace_id` per workspace (and `app.user_id` to the recipient) through the same `withWorkspaceCtx` path the API uses, under RLS as `app_user`; no BYPASSRLS role. The route lives under `/api/internal/...` and is not exposed by the public proxy route or documented in the public API.

### Coalescing
When a notification of the same `(user, issue, type)` is still unread and not archived, a new event **updates it** instead of inserting: `coalesced_count += 1`, `last_event_at = now()`, `actor_id` = latest actor, `comment_id` = latest comment. Types `mention` and `assigned` never coalesce. Items expose `coalesced_count`, `last_event_at`, `meta` (`{ from?, to? }` for status_change). Order of the list stays `id desc`.

### Subscriptions beyond issues
- `GET /subscriptions?kind=project|cycle|team|label` returns `{ items: [{ kind, entity_id, created_at }] }` (caller's own).
- `PUT /subscriptions/:kind/:entityId` 204 idempotent; `DELETE` 204 idempotent. Entity must be visible (404 otherwise). Max 200 per user (422 after).
- Effect: an issue created in, or moved into, a followed project/cycle/team, or labelled with a followed label, notifies the subscribers with type `sub_issue` and `meta.reason = "followed_<kind>"` (no extra enum value). The actor is excluded and visibility is checked by `notify()`.

### Realtime
`sync_events.entity` only allows issue|comment today; notifications use their own SSE event, not sync_events. Inserting or updating a notification emits SSE event `notification` `{ id, op: create|update }` to the recipient only, ids only (clients refetch through the authorised GET). Unread count is re-fetched by the client.

### Errors
Unknown id or someone else's: 404. Snooze past +1 year or in the past: 422. Guests: only notifications for issues they are shared on (notify() already enforces). Bad `kind`: 422; `entityId` that is not a uuid: 422. Guests on `/subscriptions` (list, PUT, DELETE): 403.

### DDL
`sql/0803_a6_notification_engine.*`: enum labels, columns `coalesced_count`, `last_event_at`, `meta`, partial index for coalescing, `entity_subscriptions` (RLS tenant + restrictive own_rows, which applies to SELECT too: fan-out therefore reads subscribers only through the SECURITY DEFINER `entity_subscribers(kind, entity_id)`, tenant from `app.workspace_id`, owner `definer`, EXECUTE revoked from PUBLIC and granted to app_user), the unique partial index `notifications_coalesce_uq (workspace_id, user_id, issue_id, type) WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN (mention, assigned)`, and grants `SELECT, UPDATE ON notifications` and `SELECT ON entity_subscriptions` to `definer` (BYPASSRLS, so the restrictive policies do not block the definer path). `notify()` coalesces with `INSERT ... ON CONFLICT (workspace_id, user_id, issue_id, type) WHERE <same predicate> DO UPDATE`. `notify()` gets a new body (coalescing upsert) in the implementing migration; its signature is unchanged, owner stays `definer`.

### Tests required
One per row of the producer table; actor never notified; hidden issue never notifies; muted follower skipped; preference off skips; coalescing counts and does not coalesce mention/assigned; read notification does not coalesce; subscription effect; RLS between users; cron secret 401 wrong/missing and 503 when unset; definer coalesces ANOTHER user's unread row (actor A notifies B twice: one row, count 2); entity_subscribers returns other users' subscriptions while a direct SELECT by app_user returns only its own; existing duplicate unread rows are merged by the migration.
