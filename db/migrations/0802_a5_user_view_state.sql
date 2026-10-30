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

-- Deleting a saved view also drops every user's view:<id> state. app_user cannot see other users' rows (own_rows), so this is
-- SECURITY DEFINER (owned by `definer`, BYPASSRLS). Scoped to the caller's workspace, and only once the view is gone.
-- DOWN: DROP FUNCTION purge_view_state(uuid); (then drop the two tables as in 0802 down)
CREATE FUNCTION purge_view_state(p_view uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH del AS (
    DELETE FROM public.user_view_state s
    WHERE s.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND s.scope = 'view:' || p_view::text
      AND NOT EXISTS (SELECT 1 FROM public.saved_views v WHERE v.id = p_view AND v.workspace_id = s.workspace_id)
    RETURNING 1)
  SELECT count(*)::int FROM del $$;
GRANT CREATE ON SCHEMA public TO definer;
ALTER FUNCTION purge_view_state(uuid) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT, DELETE ON user_view_state TO definer;
GRANT SELECT ON saved_views TO definer;
REVOKE ALL ON FUNCTION purge_view_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_view_state(uuid) TO app_user;
