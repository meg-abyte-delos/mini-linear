-- Area 9 / part 3c: issue templates per team. Tenant RLS (ENABLE + FORCE, USING + WITH CHECK) like every tenant table.
BEGIN;
CREATE TABLE IF NOT EXISTS issue_templates (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL, name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 255), description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 100000),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4), label_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(label_ids) <= 50),
  created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS issue_templates_ws_team_idx ON issue_templates (workspace_id, team_id);
CREATE UNIQUE INDEX IF NOT EXISTS issue_templates_team_name_uq ON issue_templates (team_id, lower(name));
ALTER TABLE issue_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_templates
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON issue_templates TO app_user;
COMMIT;
