-- Down for 0813: drop uploaded logos and restore the https-only check. Run as a role that sees all workspaces (RLS hides
-- them from the owner role); NOT VALID keeps the check from failing on markers the owner role could not clear.
UPDATE workspaces SET logo_url = NULL WHERE logo_url LIKE 'logo:%';
ALTER TABLE workspaces DROP CONSTRAINT workspaces_logo_url_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_logo_url_check
  CHECK (logo_url IS NULL OR (char_length(logo_url) <= 2048 AND logo_url ~ '^https://[^[:space:]]+$')) NOT VALID;
DROP TABLE IF EXISTS workspace_logos;
