# A5: saved views and per-user persisted filters

## Already on main
- `saved_views` (0401) and `GET/POST /views`, `GET/PATCH/DELETE /views/:id`. Body (strict): `{ name 1..80, shared, team_id|null, layout list|board, filters, display }`. `filters` = `{ op: and|or, rules: (rule|group)[] }` (max 50 per group), rule = `{ field, op, value? }`. `display` = grouping (none|status|assignee|priority|project|cycle|label), ordering (manual|priority|created|updated|title), show_empty_groups, show_sub_issues, properties[] (max 20).
- Visible = own, or shared (and, if team-scoped, caller in that team; admin+ see all). Guests: list is 403 (`requireRole member`). Hidden view: 404. Write: owner, or admin+ for a shared view; flipping `shared` only by the owner (403). PATCH/DELETE need `If-Match` (428/412). Delete returns 204.

## Delta
### State per user and scope
The active filters/display of a list persist per user, independent of saved views (a view is a named, shareable snapshot; state is what you currently have open).
- `scope` is one of `all`, `my-issues`, `team:<uuid>`, `project:<uuid>`, `cycle:<uuid>`, `view:<uuid>` (anything else: 422).
- `GET /view-state?scope=<scope>` returns `{ scope, layout, filters, display, version, updated_at }`, or **200 with defaults** (`layout: list`, empty filters, `{}` display, `version: 0`) when nothing is stored. Member+; guest 403.
- `PUT /view-state` body strict `{ scope, layout, filters, display }`, header `If-Match: <version>` (use `0` to create). 200 with the new row. 412 `precondition_failed` on stale, 428 when missing. `filters`/`display` use exactly the schemas of `/views` (max 32 KB / 8 KB: larger is 422). Referenced ids in filter values are **not** validated (a deleted label simply matches nothing).
- `DELETE /view-state?scope=` resets to defaults, 204, idempotent.
- `GET /view-state` without scope: `{ items: [...] }` for the caller only (max 100 rows).
- Scopes `team:`/`project:`/`cycle:`/`view:` must reference something the caller can see, else 404.

### Favourites
- `GET /views/favorites` returns `{ items: [{ view_id, position, view: <View> }] }` ordered by position (only views still visible to the caller).
- `PUT /views/:id/favorite` body `{ position?: int >= 0 }` (default: end). 200. Idempotent. 404 if the view is not visible.
- `DELETE /views/:id/favorite` 204, idempotent.
- Max 50 favourites per user: the 51st is 422.

### Execution
`GET /issues` already accepts the list filters; clients translate `filters` to query params with `src/lib/filters.ts`. A server-side `GET /views/:id/issues` is **not** in this lane.

### Audit
State and favourites are personal and **not** audited. Saved view writes keep their audit as today.

### DDL
`sql/0802_a5_user_view_state.*`: `user_view_state` PK `(workspace_id, user_id, scope)`, `view_favorites` PK `(workspace_id, user_id, view_id)` with composite FK to `saved_views` (cascade). RLS tenant + RESTRICTIVE `own_rows` on `app.user_id`: even admins never read another user's state.

### Tests required
Round trip + defaults; stale 412 / missing 428; oversize 422; bad scope 422; invisible scope 404; user B never sees A's state (RLS); favourite on a view that becomes invisible disappears from the list; cap 50; cascade when the view is deleted.
