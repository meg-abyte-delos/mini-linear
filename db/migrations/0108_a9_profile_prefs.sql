-- Area 9 / part 3b: user profile & preferences. users stays RLS-exempt (only reached by the session owner via the auth repo).
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text
  CHECK (display_name IS NULL OR (char_length(btrim(display_name)) BETWEEN 1 AND 80));
-- https only: blocks javascript:/data: URLs from ever reaching an <img src>.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text
  CHECK (avatar_url IS NULL OR (char_length(avatar_url) <= 2048 AND avatar_url ~ '^https://'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'system'
  CHECK (theme IN ('light', 'dark', 'system'));
COMMIT;
