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
Followers = issue_subscribers not muted + creator + assignee (auto-subscribed on create, comment, mention, assignment). The actor never notifies self. `due_soon` is produced by `POST /internal/notifications/due-soon` (header `x-cron-secret`, 401 otherwise), idempotent; scheduling is infra's job.

### Coalescing
When a notification of the same `(user, issue, type)` is still unread and not archived, a new event **updates it** instead of inserting: `coalesced_count += 1`, `last_event_at = now()`, `actor_id` = latest actor, `comment_id` = latest comment. Types `mention` and `assigned` never coalesce. Items expose `coalesced_count`, `last_event_at`, `meta` (`{ from?, to? }` for status_change). Order of the list stays `id desc`.

### Subscriptions beyond issues
- `GET /subscriptions?kind=project|cycle|team|label` returns `{ items: [{ kind, entity_id, created_at }] }` (caller's own).
- `PUT /subscriptions/:kind/:entityId` 204 idempotent; `DELETE` 204 idempotent. Entity must be visible (404 otherwise). Max 200 per user (422 after).
- Effect: an issue created in, or moved into, a followed project/cycle/team, or labelled with a followed label, notifies the subscribers with type `sub_issue` and `meta.reason = "followed_<kind>"` (no extra enum value). The actor is excluded and visibility is checked by `notify()`.

### Realtime
`sync_events.entity` only allows issue|comment today; notifications use their own SSE event, not sync_events. Inserting or updating a notification emits SSE event `notification` `{ id, op: create|update }` to the recipient only, ids only (clients refetch through the authorised GET). Unread count is re-fetched by the client.

### Errors
Unknown id or someone else's: 404. Snooze past +1 year or in the past: 422. Guests: only notifications for issues they are shared on (notify() already enforces). Bad `kind`: 422.

### DDL
`sql/0803_a6_notification_engine.*`: enum labels, columns `coalesced_count`, `last_event_at`, `meta`, partial index for coalescing, `entity_subscriptions` (RLS tenant + own_rows). `notify()` gets a new body (coalescing upsert) in the implementing migration; its signature is unchanged, owner stays `definer`.

### Tests required
One per row of the producer table; actor never notified; hidden issue never notifies; muted follower skipped; preference off skips; coalescing counts and does not coalesce mention/assigned; read notification does not coalesce; subscription effect; RLS between users; cron secret 401.
