-- Area 1 / part 5: issue archiving (Linear parity). Archived issues stay readable but are hidden from lists by default.
-- issues already has RLS (0001) and app_user grants; adding a column needs no new policy.
BEGIN;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS archived_at timestamptz;
-- Default list path: live, non-archived issues ordered by sort_key.
CREATE INDEX IF NOT EXISTS issues_active_sort_idx ON issues (workspace_id, sort_key, id) WHERE deleted_at IS NULL AND archived_at IS NULL;
COMMIT;
