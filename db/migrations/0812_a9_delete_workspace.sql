-- Settings API: delete the current workspace (owner only). workspaces is FORCE RLS and app_user has no DELETE on it,
-- so, like update_workspace_settings, a narrow SECURITY DEFINER function does it. Unlike that one it is NOT owned by
-- `definer`: deleting a tenant fires the delete-side triggers of many tables (sync, webhooks, notifications) that write
-- to tables `definer` has no grant on, and mirroring all of them would widen `definer` for one rare path. It stays owned
-- by the migration role instead (all table privileges, still bound by tenant RLS: app.workspace_id is set and checked).
-- Every tenant table references workspaces ON DELETE CASCADE, so one delete removes the whole tenant (audit trail included).
BEGIN;
CREATE OR REPLACE FUNCTION delete_workspace() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
        uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF ws IS NULL OR uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.workspace_id = ws AND m.user_id = uid AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'not a workspace owner' USING ERRCODE = '42501';
  END IF;
  -- The sync triggers on comments/issues write sync_seq/sync_events for this workspace on every delete; run inside the
  -- final cascade they would re-insert rows pointing at the workspace being deleted (FK violation). So empty them first,
  -- while the workspace still exists; the events they emit are removed by the workspace cascade right after.
  DELETE FROM public.issues WHERE workspace_id = ws;
  DELETE FROM public.comments WHERE workspace_id = ws;
  -- The cascade still fires the BEFORE STATEMENT sync_lock on the (now empty) issues/comments: tell it to stand down.
  PERFORM set_config('app.ws_deleting', 'on', true);
  DELETE FROM public.workspaces w WHERE w.id = ws;
  RETURN FOUND;
END $$;
-- sync_lock only orders lock acquisition (seq row first) to avoid deadlocks; it emits nothing. During a workspace delete the
-- workspace row is already gone when the cascade statements fire it, so the seq upsert would violate its FK: skip it then.
-- (A caller forging the flag only loses the deadlock-ordering hint for its own writes; events come from sync_emit.)
CREATE OR REPLACE FUNCTION sync_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $f$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
BEGIN
  IF ws IS NOT NULL AND coalesce(current_setting('app.ws_deleting', true), '') <> 'on' THEN
    INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (ws, 0) ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq;
  END IF;
  RETURN NULL;
END $f$;
REVOKE ALL ON FUNCTION delete_workspace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_workspace() TO app_user;
COMMIT;
