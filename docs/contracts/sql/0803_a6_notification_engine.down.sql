-- Postgres cannot drop enum labels, and notify() depends on the type: the labels reply/sub_issue/relation stay (unused, harmless;
-- up uses IF NOT EXISTS so up/down/up works). Everything else is reverted and the rows using them are deleted.
DROP TABLE IF EXISTS entity_subscriptions;
DROP INDEX IF EXISTS notifications_coalesce_idx;
DELETE FROM notifications WHERE type::text IN ('reply','sub_issue','relation');
DELETE FROM notification_preferences WHERE type::text IN ('reply','sub_issue','relation');
ALTER TABLE notifications DROP COLUMN IF EXISTS meta, DROP COLUMN IF EXISTS last_event_at, DROP COLUMN IF EXISTS coalesced_count;
