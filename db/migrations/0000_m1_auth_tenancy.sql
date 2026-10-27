-- M1 auth/tenancy. Run as the OWNER role. app_user must be NOSUPERUSER NOBYPASSRLS and own nothing (S12).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN
    CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

CREATE TYPE workspace_role AS ENUM ('owner','admin','member','guest');

CREATE TABLE users (
  id uuid PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL,
  email_verified_at timestamptz, failed_logins integer NOT NULL DEFAULT 0, locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE TABLE sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE TABLE email_verifications (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE password_resets (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE memberships (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role workspace_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX memberships_ws_user_uq ON memberships (workspace_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE TABLE teams (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id));
CREATE TABLE team_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (team_id, user_id),
  -- composite FK: a child row cannot point at a team of another workspace (FK checks bypass RLS)
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);
CREATE TABLE invites (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL, role workspace_role NOT NULL, token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rate_limits (
  key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL DEFAULT 0, PRIMARY KEY (key, window_start));

-- RLS: ENABLE + FORCE, USING + WITH CHECK, unset setting => zero rows.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','teams','team_memberships','invites'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- workspaces: FORCE RLS keyed on id (S12 decision: not allowlisted). Reads go through resolve_workspace().
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspaces
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- SECURITY NOTE: resolve_workspace is SECURITY DEFINER and TRUSTS p_user. It must only ever be called by the
-- session layer with the user id derived from a validated session token, never with a client-supplied id.
-- Workspace from slug, only if the user is a member (membership-derived; client workspace_id ignored).
CREATE FUNCTION resolve_workspace(p_slug text, p_user uuid)
RETURNS TABLE (workspace_id uuid, role workspace_role)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT w.id, m.role FROM public.workspaces w JOIN public.memberships m ON m.workspace_id = w.id
  WHERE w.slug = p_slug AND m.user_id = p_user $$;

-- Invite acceptance: single narrow lookup by token hash; returns only workspace_id, email, role.
CREATE FUNCTION lookup_invite(p_token_hash text)
RETURNS TABLE (invite_id uuid, workspace_id uuid, email text, role workspace_role)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.workspace_id, i.email, i.role FROM public.invites i
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now() $$;

-- SECURITY DEFINER functions must read FORCE-RLS tables: they are owned by a NOLOGIN BYPASSRLS role
-- (created once by a superuser at bootstrap, see db/bootstrap-roles.sql; owner role is a member of it).
GRANT USAGE, CREATE ON SCHEMA public TO definer; -- needed by ALTER FUNCTION ... OWNER TO
ALTER FUNCTION resolve_workspace(text, uuid) OWNER TO definer;
ALTER FUNCTION lookup_invite(text) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT ON workspaces, memberships, invites TO definer;

REVOKE ALL ON FUNCTION resolve_workspace(text, uuid), lookup_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_workspace(text, uuid), lookup_invite(text) TO app_user;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, email_verifications, password_resets,
  memberships, teams, team_memberships, invites, rate_limits TO app_user;
GRANT INSERT ON workspaces TO app_user; -- reads of workspaces go through resolve_workspace()
