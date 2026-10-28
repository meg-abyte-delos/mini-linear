-- Area 1 / 0104: issue attachments (links and file references). No binary storage: a file is a URL + metadata.
CREATE TABLE issue_attachments (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('link', 'file')),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://[^[:space:]]+$'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  mime_type text CHECK (mime_type IS NULL OR char_length(mime_type) <= 255),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_attachments_issue_idx ON issue_attachments (issue_id, created_at, id);

-- Activity feed: audit rows of one entity, newest first.
CREATE INDEX audit_events_entity_idx ON audit_events (workspace_id, entity_id, created_at DESC, id DESC);

ALTER TABLE issue_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue_attachments
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON issue_attachments TO app_user;
