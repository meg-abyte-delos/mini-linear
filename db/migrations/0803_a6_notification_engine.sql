-- A6: more event types, coalescing, non-issue subscriptions. ALTER TYPE ADD VALUE cannot run in a transaction block: no BEGIN/COMMIT here.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reply';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'sub_issue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'relation';
ALTER TABLE notifications
  ADD COLUMN coalesced_count integer NOT NULL DEFAULT 1 CHECK (coalesced_count >= 1),
  ADD COLUMN last_event_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND pg_column_size(meta) <= 2048);
-- Existing duplicates would block the unique index: keep the newest unread row per key, count the others into it.
WITH d AS (SELECT id, row_number() OVER (PARTITION BY workspace_id,user_id,issue_id,type ORDER BY last_event_at DESC, created_at DESC, id DESC) rn, count(*) OVER (PARTITION BY workspace_id,user_id,issue_id,type) c
  FROM notifications WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned'))
UPDATE notifications n SET coalesced_count = d.c FROM d WHERE n.id = d.id AND d.rn = 1 AND d.c > 1;
DELETE FROM notifications n USING (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY workspace_id,user_id,issue_id,type ORDER BY last_event_at DESC, created_at DESC, id DESC) rn FROM notifications WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned')) x WHERE rn > 1) d WHERE n.id = d.id;
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
-- ALTER ... OWNER TO needs CREATE on the schema for the new owner. Grant it only if definer lacks it, and revoke only what we granted,
-- so a prior grant is never silently removed. The function itself is created by the migration role.
DO $do$ DECLARE had boolean := has_schema_privilege('definer', 'public', 'CREATE'); BEGIN
  IF NOT had THEN GRANT CREATE ON SCHEMA public TO definer; END IF;
  ALTER FUNCTION entity_subscribers(text, uuid) OWNER TO definer;
  IF NOT had THEN REVOKE CREATE ON SCHEMA public FROM definer; END IF;
END $do$;
REVOKE ALL ON FUNCTION entity_subscribers(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION entity_subscribers(text, uuid) TO app_user;

-- realtime: sync_events extended (L8): new entities, optional issue_id, per-user events (user_id), scope.
ALTER TABLE sync_events DROP CONSTRAINT sync_events_entity_check;
ALTER TABLE sync_events ADD CONSTRAINT sync_events_entity_check CHECK (entity IN ('issue','comment','relation','attachment','label','project','cycle','view','notification','view_state','favorite'));
ALTER TABLE sync_events ALTER COLUMN issue_id DROP NOT NULL;
ALTER TABLE sync_events ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE CASCADE, ADD COLUMN scope text CHECK (scope IS NULL OR length(scope) <= 64);

-- The one way for any lane to emit an event. SECURITY INVOKER: tenant from app.workspace_id, actor from app.user_id.
-- Takes the workspace seq row lock first (same order as the triggers). p_user set => only that user receives it.
CREATE FUNCTION sync_publish_ws(p_ws uuid, p_actor uuid, p_entity text, p_entity_id uuid, p_issue uuid, p_op text, p_version integer, p_user uuid, p_scope text)
RETURNS bigint LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (p_ws, 1) ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq + 1 RETURNING s.seq INTO n;
  INSERT INTO sync_events (workspace_id, id, entity, entity_id, issue_id, op, version, actor_id, user_id, scope)
    VALUES (p_ws, n, p_entity, p_entity_id, p_issue, p_op, greatest(coalesce(p_version, 0), 0), p_actor, p_user, p_scope);
  RETURN n;
END $$;
CREATE FUNCTION sync_publish(p_entity text, p_entity_id uuid, p_issue uuid, p_op text, p_version integer DEFAULT 0, p_user uuid DEFAULT NULL, p_scope text DEFAULT NULL)
RETURNS bigint LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN nullif(current_setting('app.workspace_id', true), '') IS NULL THEN NULL
    ELSE public.sync_publish_ws(nullif(current_setting('app.workspace_id', true), '')::uuid, nullif(current_setting('app.user_id', true), '')::uuid,
                                p_entity, p_entity_id, p_issue, p_op, p_version, p_user, p_scope) END $$;
GRANT EXECUTE ON FUNCTION sync_publish_ws(uuid, uuid, text, uuid, uuid, text, integer, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION sync_publish(text, uuid, uuid, text, integer, uuid, text) TO app_user;
GRANT SELECT, INSERT, UPDATE ON sync_seq TO definer;
GRANT SELECT, INSERT ON sync_events TO definer;

-- Parent roll-up: a child created, deleted, restored, re-parented, or changing status/estimate emits an `update` for its
-- parent (old and new), so clients refresh sub-issue counters. Same function as 0008 plus the last block.
CREATE OR REPLACE FUNCTION sync_emit() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE r record; n bigint; o text; iss uuid; actor uuid; p uuid; pv integer; roll boolean;
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
  roll := TG_TABLE_NAME = 'issues' AND TG_OP = 'INSERT';
  IF TG_TABLE_NAME = 'issues' AND TG_OP = 'UPDATE' THEN
    roll := OLD.parent_id IS DISTINCT FROM NEW.parent_id OR OLD.status IS DISTINCT FROM NEW.status OR OLD.estimate IS DISTINCT FROM NEW.estimate
      OR (OLD.deleted_at IS NULL) IS DISTINCT FROM (NEW.deleted_at IS NULL);
  END IF;
  IF roll THEN
    FOR p IN SELECT DISTINCT x FROM unnest(ARRAY[CASE WHEN TG_OP = 'UPDATE' THEN OLD.parent_id END, NEW.parent_id]::uuid[]) x WHERE x IS NOT NULL LOOP
      SELECT version INTO pv FROM issues WHERE id = p AND workspace_id = r.workspace_id;
      IF FOUND THEN
        INSERT INTO sync_seq AS s (workspace_id, seq) VALUES (r.workspace_id, 1)
          ON CONFLICT (workspace_id) DO UPDATE SET seq = s.seq + 1 RETURNING s.seq INTO n;
        INSERT INTO sync_events (workspace_id, id, entity, entity_id, issue_id, op, version, actor_id) VALUES (r.workspace_id, n, 'issue', p, p, 'update', pv, actor);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;



-- notify(): 0700 checks + coalescing upsert (unique partial index above) + meta + a per-user sync event (entity notification).
-- The 5-argument signature stays (wrapper); the 6-argument form carries meta. mention/assigned never coalesce.
CREATE FUNCTION notify(p_id uuid, p_recipient uuid, p_type notification_type, p_issue uuid, p_comment uuid, p_meta jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE ws uuid := nullif(current_setting('app.workspace_id', true), '')::uuid;
        actor uuid := nullif(current_setting('app.user_id', true), '')::uuid;
        r public.workspace_role; i public.issues%ROWTYPE; ok boolean; nid uuid; cnt int; ins boolean;
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
    INSERT INTO public.notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id, meta)
      VALUES (p_id, ws, p_recipient, actor, p_type, p_issue, p_comment, coalesce(p_meta, '{}'::jsonb)) ON CONFLICT DO NOTHING
      RETURNING id, coalesced_count, true INTO nid, cnt, ins;
  ELSE
    INSERT INTO public.notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id, meta)
      VALUES (p_id, ws, p_recipient, actor, p_type, p_issue, p_comment, coalesce(p_meta, '{}'::jsonb))
      ON CONFLICT (workspace_id, user_id, issue_id, type) WHERE read_at IS NULL AND archived_at IS NULL AND type NOT IN ('mention','assigned')
      DO UPDATE SET coalesced_count = notifications.coalesced_count + 1, last_event_at = now(), actor_id = EXCLUDED.actor_id,
        comment_id = coalesce(EXCLUDED.comment_id, notifications.comment_id), meta = EXCLUDED.meta || (notifications.meta - 'to')
      RETURNING id, coalesced_count, (xmax = 0) INTO nid, cnt, ins;
  END IF;
  IF nid IS NULL THEN RETURN false; END IF;
  PERFORM public.sync_publish_ws(ws, actor, 'notification', nid, p_issue, CASE WHEN ins THEN 'create' ELSE 'update' END, cnt, p_recipient, NULL);
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION notify(p_id uuid, p_recipient uuid, p_type notification_type, p_issue uuid, p_comment uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.notify(p_id, p_recipient, p_type, p_issue, p_comment, '{}'::jsonb) $$;
GRANT SELECT ON memberships TO definer;
GRANT EXECUTE ON FUNCTION sync_publish_ws(uuid, uuid, text, uuid, uuid, text, integer, uuid, text) TO definer;
DO $do$ DECLARE had boolean := has_schema_privilege('definer', 'public', 'CREATE'); BEGIN
  IF NOT had THEN GRANT CREATE ON SCHEMA public TO definer; END IF;
  ALTER FUNCTION notify(uuid, uuid, notification_type, uuid, uuid, jsonb) OWNER TO definer;
  IF NOT had THEN REVOKE CREATE ON SCHEMA public FROM definer; END IF;
END $do$;
REVOKE ALL ON FUNCTION notify(uuid, uuid, notification_type, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify(uuid, uuid, notification_type, uuid, uuid, jsonb) TO app_user;

-- Cron support (READ ONLY, no write path with elevated rights): open issues due today or tomorrow with an assignee, across workspaces.
-- The cron route then writes each notification as the recipient, under RLS, in that workspace (see the due-soon route).
CREATE FUNCTION cron_due_soon_candidates() RETURNS TABLE (workspace_id uuid, issue_id uuid, assignee_id uuid, due_date date)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.workspace_id, i.id, i.assignee_id, i.due_date FROM public.issues i
  WHERE i.deleted_at IS NULL AND i.assignee_id IS NOT NULL AND i.status NOT IN ('done','canceled') AND i.due_date BETWEEN current_date AND current_date + 1
  ORDER BY i.due_date, i.id LIMIT 5000 $$; -- bounded per run; current_date follows the DB session time zone, not the assignee
DO $do$ DECLARE had boolean := has_schema_privilege('definer', 'public', 'CREATE'); BEGIN
  IF NOT had THEN GRANT CREATE ON SCHEMA public TO definer; END IF;
  ALTER FUNCTION cron_due_soon_candidates() OWNER TO definer;
  IF NOT had THEN REVOKE CREATE ON SCHEMA public FROM definer; END IF;
END $do$;
REVOKE ALL ON FUNCTION cron_due_soon_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cron_due_soon_candidates() TO app_user;
