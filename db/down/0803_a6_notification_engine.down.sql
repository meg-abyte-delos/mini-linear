-- 0803 down. Enum labels reply/sub_issue/relation cannot be dropped (Postgres limit; up uses IF NOT EXISTS): they stay, unused.
DROP FUNCTION IF EXISTS cron_due_soon_candidates();
-- Postgres cannot drop enum labels, and notify() depends on the type: the labels reply/sub_issue/relation stay (unused, harmless;
-- up uses IF NOT EXISTS so up/down/up works). Everything else is reverted and the rows using them are deleted.
DROP TABLE IF EXISTS entity_subscriptions;
DROP INDEX IF EXISTS notifications_coalesce_uq;
DROP FUNCTION IF EXISTS entity_subscribers(text, uuid);
REVOKE SELECT, UPDATE ON notifications FROM definer;
CREATE OR REPLACE FUNCTION notify(p_id uuid, p_recipient uuid, p_type notification_type, p_issue uuid, p_comment uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
        actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        r public.workspace_role; i public.issues%ROWTYPE; ok boolean; n int;
BEGIN
  IF ws IS NULL OR actor IS NULL OR p_recipient = actor THEN RETURN false; END IF;
  SELECT role INTO r FROM public.memberships WHERE workspace_id = ws AND user_id = p_recipient;
  IF r IS NULL THEN RETURN false; END IF;
  SELECT * INTO i FROM public.issues WHERE id = p_issue AND workspace_id = ws AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r IN ('owner','admin') THEN ok := true;
  ELSIF r = 'guest' THEN
    ok := EXISTS (SELECT 1 FROM public.issue_shares s WHERE s.workspace_id = ws AND s.issue_id = p_issue AND s.guest_user_id = p_recipient AND s.revoked_at IS NULL);
  ELSE ok := EXISTS (SELECT 1 FROM public.team_memberships tm WHERE tm.workspace_id = ws AND tm.team_id = i.team_id AND tm.user_id = p_recipient);
  END IF;
  IF NOT ok THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_preferences p WHERE p.workspace_id = ws AND p.user_id = p_recipient AND p.type = p_type AND NOT p.in_app) THEN RETURN false; END IF;
  INSERT INTO public.notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id)
    VALUES (p_id, ws, p_recipient, actor, p_type, p_issue, p_comment) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
DELETE FROM notifications WHERE type::text IN ('reply','sub_issue','relation');
DELETE FROM notification_preferences WHERE type::text IN ('reply','sub_issue','relation');
ALTER TABLE notifications DROP COLUMN IF EXISTS meta, DROP COLUMN IF EXISTS last_event_at, DROP COLUMN IF EXISTS coalesced_count;

DROP FUNCTION IF EXISTS notify(uuid, uuid, notification_type, uuid, uuid, jsonb);
CREATE OR REPLACE FUNCTION sync_emit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
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

DROP FUNCTION IF EXISTS sync_publish(text, uuid, uuid, text, integer, uuid, text);
DROP FUNCTION IF EXISTS sync_publish_ws(uuid, uuid, text, uuid, uuid, text, integer, uuid, text);
DELETE FROM sync_events WHERE entity NOT IN ('issue','comment') OR issue_id IS NULL;
ALTER TABLE sync_events DROP COLUMN IF EXISTS user_id, DROP COLUMN IF EXISTS scope;
ALTER TABLE sync_events DROP CONSTRAINT IF EXISTS sync_events_entity_check;
ALTER TABLE sync_events ADD CONSTRAINT sync_events_entity_check CHECK (entity IN ('issue','comment'));
ALTER TABLE sync_events ALTER COLUMN issue_id SET NOT NULL;
REVOKE INSERT ON sync_seq, sync_events FROM definer;

