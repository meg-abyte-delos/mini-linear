-- Run after migrations. Table grants are PER TABLE, in each migration (never GRANT ... ON ALL TABLES:
-- that would re-give app_user SELECT/UPDATE/DELETE on workspaces, whose reads go through resolve_workspace()).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- Belt and braces: app_user may only INSERT into workspaces.
REVOKE SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON workspaces FROM app_user;
