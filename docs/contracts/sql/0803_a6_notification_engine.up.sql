-- A6: more event types, coalescing, non-issue subscriptions. ALTER TYPE ADD VALUE cannot run in a transaction block: no BEGIN/COMMIT here.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reply';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'sub_issue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'relation';
ALTER TABLE notifications
  ADD COLUMN coalesced_count integer NOT NULL DEFAULT 1 CHECK (coalesced_count >= 1),
  ADD COLUMN last_event_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND pg_column_size(meta) <= 2048);
-- Existing duplicates would block the unique index: keep the newest unread row per key, count the others into it.
WITH d AS (SELECT id, row_number() OVER (PARTITION BY workspace_id,user_id,issue_id,type ORDER BY id DESC) rn, count(*) OVER (PARTITION BY workspace_id,user_id,issue_id,type) c
  FROM notifications WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned'))
UPDATE notifications n SET coalesced_count = d.c FROM d WHERE n.id = d.id AND d.rn = 1 AND d.c > 1;
DELETE FROM notifications n USING (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id,user_id,issue_id,type ORDER BY id DESC) rn FROM notifications WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned')) x WHERE rn > 1) d WHERE n.id = d.id;
CREATE UNIQUE INDEX notifications_coalesce_uq ON notifications (workspace_id, user_id, issue_id, type) WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned');
CREATE TABLE entity_subscriptions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('project','cycle','team','label')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, kind, entity_id));
CREATE INDEX entity_subscriptions_entity_idx ON entity_subscriptions (workspace_id, kind, entity_id);
ALTER TABLE entity_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_subscriptions USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY own_rows ON entity_subscriptions AS RESTRICTIVE USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON entity_subscriptions TO app_user;
-- Fan-out must read OTHER users' subscriptions, which the restrictive own_rows policy forbids to app_user (it applies to SELECT).
-- definer is BYPASSRLS, so it only needs table grants. Tenant comes from app.workspace_id, never from arguments.
GRANT SELECT ON entity_subscriptions TO definer;
GRANT SELECT, UPDATE ON notifications TO definer;
CREATE FUNCTION entity_subscribers(p_kind text, p_entity uuid) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT s.user_id FROM public.entity_subscriptions s
  WHERE s.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid AND s.kind = p_kind AND s.entity_id = p_entity
$$;
GRANT USAGE, CREATE ON SCHEMA public TO definer;
ALTER FUNCTION entity_subscribers(text, uuid) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
REVOKE ALL ON FUNCTION entity_subscribers(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entity_subscribers(text, uuid) TO app_user;
-- notify(): same signature and owner as 0700, new body = 0700 checks + coalescing upsert (mention/assigned keep plain insert).
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
  IF p_type IN ('mention','assigned') THEN
    INSERT INTO public.notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id)
      VALUES (p_id, ws, p_recipient, actor, p_type, p_issue, p_comment) ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id)
      VALUES (p_id, ws, p_recipient, actor, p_type, p_issue, p_comment)
      ON CONFLICT (workspace_id, user_id, issue_id, type) WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned')
      DO UPDATE SET coalesced_count = notifications.coalesced_count + 1, last_event_at = now(), actor_id = EXCLUDED.actor_id, comment_id = EXCLUDED.comment_id;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
