# A7: full-text search for Cmd+K and Search

## Already on main (0007, 0009, `GET /search`)
- Generated `tsv` (config `simple`, no stemming) on issues (title A, description B), comments, projects + GIN. RPC `search_workspace` is SECURITY INVOKER: team / guest-share visibility and soft-delete are applied before ranking and LIMIT.
- `GET /search?q&kind&status&team_id&assignee_id&project_id&label_id&limit&cursor`. `q` is trimmed, 1..200 chars; empty or missing: 422 `validation_failed`. `kind` is a single value `issue|comment|project` (omitted = all). Prefix match on the last token (min 2 alphanumerics), websearch syntax for the rest (quotes, `-`, `or`). An identifier query (`DEM-12`) ranks that issue first.
- Item: `{ kind, id, issue_id|null, identifier|null, title, snippet (with <mark>), rank, status|null, team_id|null, project_id|null, assignee_id|null }`. Order `(rank desc, id asc)`, cursor `(rank, id)`.
- Visibility: owner/admin all; member their teams' issues and projects sharing a team; guest only shared issues and their comments, no projects. Projects are skipped when an issue-only filter (status, assignee, label) is set.
- Errors: bad uuid or enum param 422; foreign-workspace ids in filters match nothing; invalid cursor 400 `bad_request`; unauthenticated 401.

## Delta
1. `kind` accepts a comma list (`kind=issue,project`) and a new kind `attachment` (title match via `issue_attachments.tsv`, visibility of its issue). Unknown kind: 422. Views and users are not search kinds: Cmd+K resolves them client-side from `/views` and `/members`.
2. New filters: `priority` (0..4), `cycle_id`, `state_id`, `due_before` / `due_after` (dates), `has_attachment` (bool), `include_done` (default true; false hides done/canceled). Any issue-only filter drops projects.
3. Sort: `sort=rank` (default) or `sort=updated` (`updated_at desc, id`). A cursor from the other sort is 400.
4. Item additions: `updated_at`, `parent_identifier|null`, `matched: ["title"|"description"|"comment"|"attachment"]`. Snippet is HTML-escaped except `<mark>`; render it as text plus mark only.
5. Cmd+K support:
   - `GET /search/recents` returns `{ items: [{ id, kind: query|issue|project, query|null, entity_id|null, created_at }] }`, newest first, max 20; entities no longer visible are dropped.
   - `POST /search/recents` body strict `{ kind, query?, entity_id? }` (`query` iff kind=query, else `entity_id` required and visible: 422 / 404). 201. Re-adding the same query or entity moves it to the top. Keeps the 50 newest per user.
   - `DELETE /search/recents` 204 clears the caller's list; `DELETE /search/recents/:id` 204 idempotent.
   - Member+. Guests: kind issue only.
6. Rate limit: 60 requests/min per user on `/search` (429 `rate_limited`). Clients debounce at 150 ms.

### DDL
`sql/0804_a7_search_extras.*`: `search_recents` (RLS tenant + own_rows, index starts with `workspace_id`), `issue_attachments.tsv` + GIN. No extension (pg_trgm deliberately avoided: no typo tolerance in this lane). `search_workspace` is replaced in the implementing migration (new params appended at the end).

### Tests required
Empty / 201-char q 422; each filter alone and combined; projects dropped with issue filters; guest sees shared issues only; member of team B never sees a team A hit (including at a `limit=1` page boundary); cursor vs sort; kind list; attachment hit visibility; recents dedupe, cap, RLS between users, hidden entity dropped; identifier query first.
