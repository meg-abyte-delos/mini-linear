-- Down for 0812: remove the owner-only workspace delete function.
DROP FUNCTION IF EXISTS delete_workspace();
-- Restore sync_lock from 0008.
CREATE OR REPLACE FUNCTION sync_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
BEGIN
  IF ws IS NOT NULL THEN
    INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (ws, 0) ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq;
  END IF;
  RETURN NULL;
END $$;
