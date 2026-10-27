-- Workspaces are not readable by app_user (FORCE RLS keyed on app.workspace_id, S12). Listing "my workspaces" needs a
-- narrow SECURITY DEFINER function, like resolve_workspace. It TRUSTS p_user: call it only with a session-derived id.
CREATE FUNCTION list_my_workspaces(p_user uuid)
RETURNS TABLE (id uuid, slug text, name text, role workspace_role)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT w.id, w.slug, w.name, m.role FROM public.workspaces w JOIN public.memberships m ON m.workspace_id = w.id
  WHERE m.user_id = p_user ORDER BY w.created_at, w.id $$;
GRANT USAGE, CREATE ON SCHEMA public TO definer;
ALTER FUNCTION list_my_workspaces(uuid) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
REVOKE ALL ON FUNCTION list_my_workspaces(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_my_workspaces(uuid) TO app_user;
