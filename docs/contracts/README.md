# Contracts A4 to A8 (backend, Ada)

Base: main 10d7b49. Binding for Linus, Iris, Tess. Each lane lists **what already exists on main** (do not rebuild), then the **delta** (new DDL and routes).
One file per lane: [A4](A4-subissues-relations-estimates.md), [A5](A5-saved-views.md), [A6](A6-notifications.md), [A7](A7-search.md), [A8](A8-attachments.md). DDL lives in `sql/` as `NNNN_name.up.sql` + `.down.sql`.

## Conventions (all routes)
- Base `/api/v1/w/<slug>/...`, JSON. Error envelope `{ error: { code, message, request_id, details? } }`.
- Codes: `bad_request` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `precondition_failed` 412, `precondition_required` 428, `validation_failed` 422, `rate_limited` 429.
- A resource the caller may not see is **404** (team visibility, guest without share, foreign workspace), never 403.
- Roles: `owner > admin > member > guest`. Guests are read-only and see only issues with an active share. Member writes need team membership of the issue's team.
- Lists: `?limit=1..100` (default 50), `?cursor=` signed and bound to workspace + list; reply `{ items, next_cursor }`. PATCH needs `If-Match: <version>` (428 missing, 412 stale).
- Zod `.strict()` bodies: unknown keys are 422. Every write is audited (`audit_events`) and RLS is ENABLE+FORCE. S12: every index starts with `workspace_id`.
- Migrations: numbers 0801 to 0805 (A4..A8, free range on main). Each has a `.down.sql`; tested up, down, up on a fresh DB built from all of main's migrations. Down files are applied by hand or by the test helper, not by the CI runner (which only reads `db/migrations/*.sql`). The PR that implements a lane moves its `.up.sql` into `db/migrations/`.
- Exception: `0803 down` cannot drop enum labels (Postgres limit, and `notify()` depends on the type): the 3 new labels stay, unused.
