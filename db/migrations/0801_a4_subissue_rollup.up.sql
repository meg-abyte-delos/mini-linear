-- A4: child lookup for rollups. No new table. S12: indexes start with workspace_id.
CREATE INDEX issues_parent_ws_idx ON issues (workspace_id, parent_id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX issue_relations_ws_related_idx ON issue_relations (workspace_id, related_issue_id, type);
