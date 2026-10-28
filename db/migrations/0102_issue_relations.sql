-- Area 1 part 2: issue relations (Linear parity). Run as OWNER after 0001.
-- Stored canonically: 'blocks' (issue_id blocks related_issue_id), 'related' (symmetric, issue_id < related_issue_id),
-- 'duplicate' (issue_id is a duplicate of related_issue_id). 'blocked_by' is never stored: it is the inverse view of 'blocks'.
-- At most one relation per unordered pair; no self-relation; both ends in the same workspace (composite FKs).
CREATE TYPE issue_relation_type AS ENUM ('blocks','related','duplicate');

CREATE TABLE issue_relations (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type issue_relation_type NOT NULL, issue_id uuid NOT NULL, related_issue_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CHECK (issue_id <> related_issue_id),
  CHECK (type <> 'related' OR issue_id < related_issue_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (related_issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX issue_relations_pair_uq ON issue_relations (workspace_id, LEAST(issue_id, related_issue_id), GREATEST(issue_id, related_issue_id));
CREATE INDEX issue_relations_issue_idx ON issue_relations (issue_id);
CREATE INDEX issue_relations_related_idx ON issue_relations (related_issue_id);

ALTER TABLE issue_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_relations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Relations are created and removed, never edited.
GRANT SELECT, INSERT, DELETE ON issue_relations TO app_user;
