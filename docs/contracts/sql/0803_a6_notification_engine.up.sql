-- A6: more event types, coalescing, non-issue subscriptions. ALTER TYPE ADD VALUE cannot run in a transaction block: no BEGIN/COMMIT here.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reply';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'sub_issue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'relation';
ALTER TABLE notifications
  ADD COLUMN coalesced_count integer NOT NULL DEFAULT 1 CHECK (coalesced_count >= 1),
  ADD COLUMN last_event_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND pg_column_size(meta) <= 2048);
CREATE INDEX notifications_coalesce_idx ON notifications (workspace_id, user_id, issue_id, type) WHERE read_at IS NULL AND archived_at IS NULL;
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
