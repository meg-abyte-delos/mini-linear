-- Area 4: saved views (personal + shared). Tenant table: RLS ENABLE+FORCE, composite FKs keep rows in-tenant.
CREATE TABLE saved_views (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  team_id uuid, -- optional scope; NULL = workspace-wide
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  shared boolean NOT NULL DEFAULT false,
  layout text NOT NULL DEFAULT 'list' CHECK (layout IN ('list','board')),
  filters jsonb NOT NULL DEFAULT jsonb_build_object('op','and','rules','[]'::jsonb) CHECK (jsonb_typeof(filters) = 'object' AND pg_column_size(filters) <= 32768),
  display jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(display) = 'object' AND pg_column_size(display) <= 8192),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX saved_views_ws_idx ON saved_views (workspace_id, id);
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saved_views
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_views TO app_user;
