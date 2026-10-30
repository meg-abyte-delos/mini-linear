DELETE FROM issue_attachments WHERE storage_key IS NOT NULL;
REVOKE UPDATE ON issue_attachments FROM app_user;
DROP INDEX IF EXISTS issue_attachments_gc_idx, issue_attachments_storage_uq;
ALTER TABLE issue_attachments DROP CONSTRAINT issue_attachments_url_check;
ALTER TABLE issue_attachments ALTER COLUMN url SET NOT NULL;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_url_check CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://[^[:space:]]+$');
ALTER TABLE issue_attachments DROP COLUMN deleted_at, DROP COLUMN filename, DROP COLUMN upload_status, DROP COLUMN sha256, DROP COLUMN storage_key;
