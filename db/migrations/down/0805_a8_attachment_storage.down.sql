-- Reverse of 0805 (applied by hand or by the test helper; the CI runner only reads db/migrations/*.sql). Idempotent.
-- Uploaded rows are deleted; their bytes stay in the store for the orphan sweep.
DROP FUNCTION IF EXISTS attachments_gc_claim(integer);
REVOKE SELECT, UPDATE, DELETE ON issue_attachments FROM definer;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'issue_attachments' AND column_name = 'storage_key') THEN
    DELETE FROM issue_attachments WHERE storage_key IS NOT NULL;
  END IF;
END $$;
REVOKE UPDATE ON issue_attachments FROM app_user;
DROP INDEX IF EXISTS issue_attachments_gc_idx;
DROP INDEX IF EXISTS issue_attachments_storage_uq;
ALTER TABLE issue_attachments DROP CONSTRAINT IF EXISTS issue_attachments_url_check;
ALTER TABLE issue_attachments ALTER COLUMN url SET NOT NULL;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_url_check CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://[^[:space:]]+$');
ALTER TABLE issue_attachments DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS filename, DROP COLUMN IF EXISTS upload_started_at, DROP COLUMN IF EXISTS upload_status, DROP COLUMN IF EXISTS sha256, DROP COLUMN IF EXISTS storage_key;
