-- A7: recent searches/visits per user; attachment titles searchable. No extension required.
CREATE TABLE search_recents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('query','issue','project')),
  query text CHECK (query IS NULL OR char_length(query) BETWEEN 1 AND 200),
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'query') = (query IS NOT NULL AND entity_id IS NULL)));
CREATE INDEX search_recents_user_idx ON search_recents (workspace_id, user_id, created_at DESC);
ALTER TABLE search_recents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_recents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search_recents USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY own_rows ON search_recents AS RESTRICTIVE USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON search_recents TO app_user;
ALTER TABLE issue_attachments ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED;
CREATE INDEX issue_attachments_tsv_idx ON issue_attachments USING gin (tsv);
