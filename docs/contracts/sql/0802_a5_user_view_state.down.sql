DROP FUNCTION IF EXISTS purge_view_state(uuid);
REVOKE SELECT, DELETE ON user_view_state FROM definer;
REVOKE SELECT ON saved_views FROM definer;
DROP TABLE IF EXISTS view_favorites;
DROP TABLE IF EXISTS user_view_state;
