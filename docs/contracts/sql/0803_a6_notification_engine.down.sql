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
