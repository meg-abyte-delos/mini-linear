-- Area 9 / part 3: invite hardening (#51 revoked_at, #55 accept audit).
-- Revoking keeps the row (audit trail) instead of deleting it; a revoked invite behaves exactly like an unknown one.
BEGIN;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
CREATE INDEX IF NOT EXISTS invites_pending_idx ON invites (workspace_id, lower(email)) WHERE used_at IS NULL AND revoked_at IS NULL;
-- Same narrow signature as 0005 (workspace_id, email only); only adds the revoked_at predicate.
CREATE OR REPLACE FUNCTION lookup_invite(p_token_hash text)
RETURNS TABLE (workspace_id uuid, email text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.workspace_id, i.email FROM public.invites i
  WHERE i.token_hash = p_token_hash AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() $$;
REVOKE ALL ON FUNCTION lookup_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_invite(text) TO app_user;
COMMIT;
