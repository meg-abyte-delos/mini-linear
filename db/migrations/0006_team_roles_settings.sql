-- Area 9 part 1: workspace settings + team roles (admin/member/guest) enforced by RLS.
-- Shared interface owned here: has_team_role(uuid, text), is_workspace_admin(uuid). The existing table is
-- team_memberships (not team_members): it gains the role column instead of a duplicate table.
-- The acting user travels in app.user_id, set by the session layer next to app.workspace_id (src/lib/http/ctx.ts).
-- Like resolve_workspace, the SECURITY DEFINER helpers TRUST that setting: only the session layer may set it.
-- This repo has no assert_mfa() guard (no MFA in M1); guards here are tenant match + session user.
BEGIN;
ALTER TABLE team_memberships ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member','guest'));
ALTER TABLE workspaces ADD COLUMN logo_url text
  CHECK (logo_url IS NULL OR (char_length(logo_url) <= 2048 AND logo_url ~ '^https://[^[:space:]]+$'));

CREATE OR REPLACE FUNCTION is_workspace_admin(p_workspace_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT p_workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
      AND m.role IN ('owner','admin')) $$;

-- guest < member < admin. Workspace owners/admins hold every team role. A workspace guest is capped at 'guest'
-- whatever its team row says. Unknown p_min_role => false (fail closed).
CREATE OR REPLACE FUNCTION has_team_role(p_team_id uuid, p_min_role text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  WITH me AS (SELECT nullif(current_setting('app.user_id', true), '')::uuid AS uid,
                     nullif(current_setting('app.workspace_id', true), '')::uuid AS ws),
  need AS (SELECT CASE p_min_role WHEN 'guest' THEN 1 WHEN 'member' THEN 2 WHEN 'admin' THEN 3 END AS n)
  SELECT coalesce((
    SELECT CASE WHEN m.role IN ('owner','admin') THEN 3
                -- not on the team => 0 (coalesce: least() would silently ignore a NULL)
                ELSE least(CASE WHEN m.role = 'guest' THEN 1 ELSE 3 END,
                           coalesce((SELECT CASE tm.role WHEN 'guest' THEN 1 WHEN 'member' THEN 2 WHEN 'admin' THEN 3 END
                              FROM public.team_memberships tm WHERE tm.team_id = p_team_id AND tm.user_id = me.uid), 0)) END
    FROM me JOIN public.teams t ON t.id = p_team_id AND t.workspace_id = me.ws
    JOIN public.memberships m ON m.workspace_id = me.ws AND m.user_id = me.uid), 0) >= (SELECT n FROM need)
  AND (SELECT n FROM need) IS NOT NULL $$;

-- Workspace settings: app_user cannot read/update workspaces (S12), so a narrow definer function, admins only.
CREATE OR REPLACE FUNCTION update_workspace_settings(p_name text, p_slug text, p_logo_url text)
RETURNS TABLE (id uuid, slug text, name text, logo_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
BEGIN
  IF ws IS NULL OR NOT public.is_workspace_admin(ws) THEN
    RAISE EXCEPTION 'not a workspace admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY UPDATE public.workspaces w SET name = coalesce(p_name, w.name), slug = coalesce(p_slug, w.slug),
    logo_url = CASE WHEN p_logo_url IS NULL THEN w.logo_url WHEN p_logo_url = '' THEN NULL ELSE p_logo_url END
    WHERE w.id = ws RETURNING w.id, w.slug, w.name, w.logo_url;
END $$;

CREATE OR REPLACE FUNCTION get_workspace_settings() RETURNS TABLE (id uuid, slug text, name text, logo_url text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT w.id, w.slug, w.name, w.logo_url FROM public.workspaces w
  JOIN public.memberships m ON m.workspace_id = w.id AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
  WHERE w.id = nullif(current_setting('app.workspace_id', true), '')::uuid $$;

GRANT USAGE, CREATE ON SCHEMA public TO definer;
ALTER FUNCTION is_workspace_admin(uuid) OWNER TO definer;
ALTER FUNCTION has_team_role(uuid, text) OWNER TO definer;
ALTER FUNCTION update_workspace_settings(text, text, text) OWNER TO definer;
ALTER FUNCTION get_workspace_settings() OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT ON teams, team_memberships TO definer;
GRANT UPDATE (name, slug, logo_url) ON workspaces TO definer;
REVOKE ALL ON FUNCTION is_workspace_admin(uuid), has_team_role(uuid, text),
  update_workspace_settings(text, text, text), get_workspace_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_workspace_admin(uuid), has_team_role(uuid, text),
  update_workspace_settings(text, text, text), get_workspace_settings() TO app_user;

-- RESTRICTIVE role policies, scoped TO app_user (the owner seeds/migrates under tenant isolation only); both they and
-- the permissive tenant_isolation policy must pass. The S12 gate (scripts/check-rls.mts) requires the tenant predicate
-- in USING and WITH CHECK of every policy, so these are FOR ALL with a tenant-only USING (reads unchanged) and the role
-- check in WITH CHECK, which Postgres applies to INSERT and to the new row of UPDATE. DELETE is role-gated in the API
-- (deleteTeam / removeTeamMember / cycles), not here: a DELETE-only policy cannot carry a WITH CHECK.
-- Role checks apply to session requests (app.user_id set by withWorkspaceCtx). Without a session user (raw DB
-- paths: jobs, low-level tests) only tenant isolation applies, exactly as before this migration. Workspace admins are
-- listed explicitly so an unknown/foreign team id still fails on the composite FK (422), not on RLS.
-- teams: create = workspace admin (the new row is not visible to has_team_role yet); update (issue_seq bump on issue
-- creation, rename) = team member or workspace admin.
CREATE POLICY teams_role_write ON teams AS RESTRICTIVE FOR ALL TO app_user
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND (nullif(current_setting('app.user_id', true), '') IS NULL OR is_workspace_admin(workspace_id) OR has_team_role(id, 'member')));
-- team_memberships: add / change role = team admin (workspace admins hold every team role).
CREATE POLICY tm_role_write ON team_memberships AS RESTRICTIVE FOR ALL TO app_user
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND (nullif(current_setting('app.user_id', true), '') IS NULL OR is_workspace_admin(workspace_id) OR has_team_role(team_id, 'admin')));
-- Team-scoped data: guests are read-only on their teams.
CREATE POLICY issues_team_write ON issues AS RESTRICTIVE FOR ALL TO app_user
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND (nullif(current_setting('app.user_id', true), '') IS NULL OR is_workspace_admin(workspace_id) OR has_team_role(team_id, 'member')));
CREATE POLICY cycles_team_write ON cycles AS RESTRICTIVE FOR ALL TO app_user
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND (nullif(current_setting('app.user_id', true), '') IS NULL OR is_workspace_admin(workspace_id) OR has_team_role(team_id, 'member')));
COMMIT;
