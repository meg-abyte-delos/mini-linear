-- Run after migrations. Table grants are PER TABLE, in each migration (never GRANT ... ON ALL TABLES:
-- that would re-give app_user SELECT/UPDATE/DELETE on workspaces, whose reads go through resolve_workspace()).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Belt and braces: app_user may only INSERT into workspaces.
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON workspaces FROM app_user;
-- Dev/CI convenience for webhooks: the in-process dispatcher does SET LOCAL ROLE webhook_dispatcher (needs membership).
-- PRODUCTION: run the dispatcher on its own LOGIN role (WEBHOOK_DISPATCHER_DATABASE_URL) and `REVOKE webhook_dispatcher FROM app_user`.
GRANT webhook_dispatcher TO app_user;
