-- #56: lookup_invite is SECURITY DEFINER: it must expose only what the caller needs to
-- switch to the invite's workspace (workspace_id) and compare emails (email).
-- invite id and role are read afterwards under RLS in the workspace context.
BEGIN;
DROP FUNCTION IF EXISTS lookup_invite(text);
CREATE FUNCTION lookup_invite(p_token_hash text)
RETURNS TABLE (workspace_id uuid, email text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.workspace_id, i.email FROM public.invites i
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.expires_at > now() $$;
GRANT CREATE ON SCHEMA public TO definer; -- needed by ALTER FUNCTION ... OWNER TO (same dance as 0000)
ALTER FUNCTION lookup_invite(text) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
REVOKE ALL ON FUNCTION lookup_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_invite(text) TO app_user;
COMMIT;
