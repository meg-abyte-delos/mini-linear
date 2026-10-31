-- Settings API: per-user landing page preference. users stays RLS-exempt (reached only by the session owner).
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_page text NOT NULL DEFAULT 'inbox'
  CHECK (home_page IN ('inbox', 'my-issues', 'projects', 'views'));
COMMIT;
