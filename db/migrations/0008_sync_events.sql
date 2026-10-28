-- Area 6: change feed for realtime sync, plus issue presence.
-- sync_events is an append-only per-workspace log written by triggers in the writer's transaction: a rolled-back
-- write emits nothing. Ids are allocated from sync_seq under a row lock, so within a workspace id order == commit
-- order and readers never see a gap fill in later (writers in one workspace serialise on that row, by design).
-- Payloads carry ids and versions only, never field values: clients refetch through the authorised GET endpoints.
CREATE TABLE sync_seq (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  seq bigint NOT NULL DEFAULT 0,
  pruned_upto bigint NOT NULL DEFAULT 0); -- events with id <= pruned_upto were purged: older cursors must resync

CREATE TABLE sync_events (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  entity text NOT NULL CHECK (entity IN ('issue','comment')),
  entity_id uuid NOT NULL,
  issue_id uuid NOT NULL, -- the issue the event belongs to (itself for issues): visibility is decided on it
  op text NOT NULL CHECK (op IN ('create','update','delete')),
  version integer NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id));
CREATE INDEX sync_events_created_idx ON sync_events (workspace_id, created_at); -- S12: workspace-leading; retention walks it per workspace

CREATE TABLE issue_presence (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_presence_ws_idx ON issue_presence (workspace_id, issue_id); -- S12: index leading with workspace_id

CREATE FUNCTION sync_emit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r record; n bigint; o text; iss uuid; actor uuid;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  o := CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END;
  IF TG_TABLE_NAME = 'issues' THEN
    iss := r.id;
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN o := 'delete'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN o := 'create'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.sort_key IS DISTINCT FROM OLD.sort_key
       AND (to_jsonb(NEW) - 'sort_key' - 'version' - 'updated_at') = (to_jsonb(OLD) - 'sort_key' - 'version' - 'updated_at') THEN
      RETURN NULL; -- drag-reorder only (sort_key): not a content change, no event
    END IF;
    actor := coalesce(nullif(current_setting('app.user_id', true), '')::uuid, r.created_by); -- the updater, not the creator
  ELSE
    iss := r.issue_id; actor := coalesce(nullif(current_setting('app.user_id', true), '')::uuid, r.author_id);
  END IF;
  INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (r.workspace_id, 1)
    ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq + 1 RETURNING s.seq INTO n;
  INSERT INTO sync_events (workspace_id, id, entity, entity_id, issue_id, op, version, actor_id)
    VALUES (r.workspace_id, n, CASE TG_TABLE_NAME WHEN 'issues' THEN 'issue' ELSE 'comment' END, r.id, iss, o,
            CASE WHEN TG_OP = 'DELETE' THEN r.version + 1 ELSE r.version END, actor);
  RETURN NULL;
END $$;
-- Lock order: the workspace seq row is taken FIRST, by a BEFORE STATEMENT trigger, before the statement locks any
-- issue/comment row. Every writer therefore goes seq -> rows and two writers can never wait on each other in a cycle
-- (the old per-row upsert locked seq AFTER the first row, so two bulk updates in opposite order deadlocked).
CREATE FUNCTION sync_lock() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
BEGIN
  IF ws IS NOT NULL THEN
    INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (ws, 0) ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER issues_sync_lock BEFORE INSERT OR UPDATE OR DELETE ON issues FOR EACH STATEMENT EXECUTE FUNCTION sync_lock();
CREATE TRIGGER comments_sync_lock BEFORE INSERT OR UPDATE OR DELETE ON comments FOR EACH STATEMENT EXECUTE FUNCTION sync_lock();
CREATE TRIGGER issues_sync AFTER INSERT OR UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION sync_emit();
CREATE TRIGGER comments_sync AFTER INSERT OR UPDATE OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION sync_emit();

-- Retention, called by the app purge scheduler (app_user cannot touch other tenants directly, so this is SECURITY DEFINER,
-- owned by `definer`). Keeps at least 1 day whatever the argument. Per workspace it records the high-water mark
-- (pruned_upto) so stale cursors get an explicit resync, then deletes. Presence rows expire after an hour.
CREATE FUNCTION purge_sync_events(keep interval DEFAULT interval '7 days') RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ws uuid; k interval := greatest(keep, interval '1 day');
BEGIN
  FOR ws IN SELECT workspace_id FROM public.sync_seq LOOP
    UPDATE public.sync_seq s SET pruned_upto = greatest(s.pruned_upto, x.m)
      FROM (SELECT max(id) m FROM public.sync_events WHERE workspace_id = ws AND created_at < now() - k) x
      WHERE s.workspace_id = ws AND x.m IS NOT NULL;
    DELETE FROM public.sync_events WHERE workspace_id = ws AND created_at < now() - k;
  END LOOP;
  DELETE FROM public.issue_presence WHERE seen_at < now() - interval '1 hour';
END $$;
GRANT CREATE ON SCHEMA public TO definer;
ALTER FUNCTION purge_sync_events(interval) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT, UPDATE ON sync_seq TO definer;
GRANT SELECT, DELETE ON sync_events TO definer;
GRANT SELECT, DELETE ON issue_presence TO definer;
REVOKE ALL ON FUNCTION purge_sync_events(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_sync_events(interval) TO app_user;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sync_seq','sync_events','issue_presence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
-- sync_events is append-only for app_user (triggers insert; readers select).
GRANT SELECT, INSERT ON sync_events TO app_user;
GRANT SELECT, INSERT, UPDATE ON sync_seq TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON issue_presence TO app_user;
