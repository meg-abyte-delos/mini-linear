-- Area 7: subscriptions reuse issue_subscribers (0103). `muted` is a tombstone: an explicit unsubscribe sets it, so the
-- auto-subscribe `on conflict do nothing` no longer re-adds someone who opted out. Run as OWNER after 0103.
BEGIN;
ALTER TABLE issue_subscribers ADD COLUMN muted boolean NOT NULL DEFAULT false;
GRANT UPDATE (reason, muted) ON issue_subscribers TO app_user;
-- A user may only change (mute/unmute) their own row; inserts for others (auto-subscribe) stay allowed.
CREATE POLICY own_subs_update ON issue_subscribers AS RESTRICTIVE FOR UPDATE
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
COMMIT;
