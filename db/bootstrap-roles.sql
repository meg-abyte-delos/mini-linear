-- Run ONCE as a superuser (CI service bootstrap / DBA) before migrations. Idempotent.
--   psql -v owner=owner -f db/bootstrap-roles.sql
-- owner: runs migrations; NOT superuser, NOT BYPASSRLS, so FORCE RLS applies to it as in prod.
-- definer: NOLOGIN BYPASSRLS; owns only the SECURITY DEFINER functions (the owner is a member of it).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='definer') THEN
    CREATE ROLE definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT definer TO :"owner";
