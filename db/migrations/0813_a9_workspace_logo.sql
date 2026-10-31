-- Settings API: workspace logo upload. The bytes live in the database (<= 1 MiB, one row per workspace, cascade-deleted
-- with it), not in the attachment store: that store's orphan GC deletes any key no issue_attachments row references.
-- workspaces.logo_url keeps accepting an external https URL and additionally the internal marker 'logo:<sha256[0:16]>',
-- which the API renders as the relative path /api/v1/w/<slug>/settings/logo?v=<hash> (the marker survives a slug rename).
BEGIN;
CREATE TABLE workspace_logos (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 1048576),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE workspace_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_logos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_logos
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_logos TO app_user;
ALTER TABLE workspaces DROP CONSTRAINT workspaces_logo_url_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_logo_url_check
  CHECK (logo_url IS NULL OR (char_length(logo_url) <= 2048 AND (logo_url ~ '^https://[^[:space:]]+$' OR logo_url ~ '^logo:[0-9a-f]{16}$')));
COMMIT;
