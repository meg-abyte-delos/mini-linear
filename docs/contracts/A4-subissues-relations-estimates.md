# A4: sub-issues, relations, estimates

## Already on main (do not rebuild)
- `issues.parent_id` (POST `parent_id`, PATCH `parent_id`, list filter `?parent_id=`). Trigger in 0001: no self/ancestor parent, **max depth 5 counting the node and its whole subtree**.
- Issue DTO has `sub_issues: { total, done }` (direct children, not deleted, `done` = status `done`) and `estimate` (smallint 0..64 or null), `due_date`.
- Relations (0102): `GET/POST /issues/:id/relations`, `DELETE /issues/:id/relations/:rid`. Body `{ type: blocks|blocked_by|related|duplicate, related_issue_id }`, strict. Stored canonical (`blocked_by` is the inverse of `blocks`; `related` symmetric). View: `{ id, type, issue_id (= self), related_issue_id, direction: outgoing|incoming|both, created_by, created_at }`.
- Estimate scale per team (`team_settings.estimate_scale` none|linear|fibonacci|exponential|tshirt, `estimate_allow_zero`); `assertEstimate` rejects values outside the scale (scale `none` = any 0..64).

## Errors today (Tess: test these)
| Case | Result |
|---|---|
| parent_id = own id, or a descendant (cycle) | 422 `validation_failed` (trigger check_violation, message "constraint violated") |
| tree deeper than 5 levels (attach under a depth-5 chain, or attach a subtree that would exceed) | 422 `validation_failed` |
| parent in another workspace / unknown / soft-deleted | 422 `validation_failed` ("referenced entity not found") |
| parent hidden to the caller (other team, guest) | 422 `validation_failed`, same message as unknown (no existence leak) |
| parent soft-deleted later | children keep existing; `parent_id` stays until purge (ON DELETE SET NULL on hard delete) |
| relation to self | 422 `validation_failed` |
| relation duplicate pair (any type, either direction) | 409 `conflict` |
| relation other end unknown, foreign or invisible | 422 `validation_failed` ("unknown related issue") |
| guest POST/DELETE | 403 `forbidden` |
| estimate outside team scale | 422 `validation_failed` |

## Delta
### Routes
1. `GET /issues/:id/sub-issues?limit&cursor&include=children|descendants` (default `children`). Items are the standard issue DTO, ordered `(sort_key, id)`; `descendants` returns the whole subtree flattened with a `depth` (1..4) field. Hidden/deleted issues are excluded. 404 if the parent is not visible. Read: any role that sees the parent.
2. `GET /issues/:id` and list DTO gain `estimate_rollup: { own: number|null, children: number|null, total: number }` (`children` = sum of non-null estimates of direct children; `total` = `own ?? 0` + `children ?? 0`) and `sub_issues` gains `in_progress` (children whose state category is `started`).
3. `POST /issues/:id/sub-issues` is **not** added: create a child with `POST /issues { parent_id }` (team must match the parent's team, else 422 `validation_failed` "sub-issue must be in the parent's team"; this rule is new and enforced on POST and PATCH).
4. Relations: `POST` with `type: duplicate` also accepts `{ cancel_source: true }` (default false): when true, the source issue moves to the team's first `canceled` state in the same transaction (audited as a status change). Everything else unchanged. Duplicate-of chains deeper than 1 are allowed.
5. Closing a parent does not touch children; reopening is manual. Completing the last open child does not auto-close the parent (explicit non-goal).
6. `GET /teams/:id/estimate-scale` returns `{ scale, allow_zero, values: number[] }` (member+ of the team, admin+). Replaces client-side duplication of `team-config.ts`.

### Audit / activity
Existing events (`parent_id`, `estimate`, relation create/delete) already render in the feed. New: relation `cancel_source` adds the status change event.

### DDL
`sql/0801_a4_subissue_rollup.up.sql`: two indexes only (`issues (workspace_id, parent_id)` partial, `issue_relations (workspace_id, related_issue_id, type)`). No table, no column.

### Tests required (acceptance)
Sub-issues list pagination + descendants depth; rollup arithmetic with nulls; team-mismatch 422; cycle/depth 422; guest 404 on hidden parent; cancel_source atomicity; RLS cross-workspace.
