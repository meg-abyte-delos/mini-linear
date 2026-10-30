-- A5: per-user persisted filters/display per list scope, and per-user favourite views.
CREATE TABLE user_view_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope ~ '^(all|my-issues|(team|project|cycle|view):[0-9a-f-]{36})$'),
  layout text NOT NULL DEFAULT 'list' CHECK (layout IN ('list','board')),
  filters jsonb NOT NULL DEFAULT jsonb_build_object('op','and','rules','[]'::jsonb) CHECK (jsonb_typeof(filters) = 'object' AND pg_column_size(filters) <= 32768),
  display jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(display) = 'object' AND pg_column_size(display) <= 8192),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, scope));
CREATE TABLE view_favorites (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, view_id),
  FOREIGN KEY (view_id, workspace_id) REFERENCES saved_views(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX view_favorites_user_idx ON view_favorites (workspace_id, user_id, position);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['user_view_state','view_favorites'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
    EXECUTE format($p$CREATE POLICY own_rows ON %I AS RESTRICTIVE USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_view_state, view_favorites TO app_user;
