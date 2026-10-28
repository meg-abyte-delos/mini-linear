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
CREATE INDEX sync_events_created_idx ON sync_events (created_at);

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
    actor := r.created_by;
  ELSE
    iss := r.issue_id; actor := r.author_id;
  END IF;
  INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (r.workspace_id, 1)
    ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq + 1 RETURNING s.seq INTO n;
  INSERT INTO sync_events (workspace_id, id, entity, entity_id, issue_id, op, version, actor_id)
    VALUES (r.workspace_id, n, CASE TG_TABLE_NAME WHEN 'issues' THEN 'issue' ELSE 'comment' END, r.id, iss, o,
            CASE WHEN TG_OP = 'DELETE' THEN r.version + 1 ELSE r.version END, actor);
  RETURN NULL;
END $$;
CREATE TRIGGER issues_sync AFTER INSERT OR UPDATE ON issues FOR EACH ROW EXECUTE FUNCTION sync_emit();
CREATE TRIGGER comments_sync AFTER INSERT OR UPDATE OR DELETE ON comments FOR EACH ROW EXECUTE FUNCTION sync_emit();

-- Retention: owner-run (cron), never app_user. Records the high-water mark so stale cursors get an explicit resync.
CREATE FUNCTION purge_sync_events(keep interval DEFAULT interval '7 days') RETURNS void LANGUAGE sql SET search_path = pg_catalog, public AS $$
  UPDATE sync_seq s SET pruned_upto = greatest(s.pruned_upto, x.m)
    FROM (SELECT workspace_id, max(id) m FROM sync_events WHERE created_at < now() - keep GROUP BY workspace_id) x
    WHERE x.workspace_id = s.workspace_id;
  DELETE FROM sync_events WHERE created_at < now() - keep;
  DELETE FROM issue_presence WHERE seen_at < now() - interval '1 hour';
$$;
REVOKE ALL ON FUNCTION purge_sync_events(interval) FROM PUBLIC;

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
