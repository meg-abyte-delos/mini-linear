-- A8: uploaded files. Link/file rows with an https url keep working; an upload sets storage_key and no url.
ALTER TABLE issue_attachments
  ADD COLUMN storage_key text,
  ADD COLUMN sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN upload_status text NOT NULL DEFAULT 'ready' CHECK (upload_status IN ('pending','ready')),
  ADD COLUMN filename text CHECK (filename IS NULL OR char_length(filename) BETWEEN 1 AND 255),
  ADD COLUMN deleted_at timestamptz;
ALTER TABLE issue_attachments DROP CONSTRAINT issue_attachments_url_check;
ALTER TABLE issue_attachments ALTER COLUMN url DROP NOT NULL;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_url_check CHECK (
  (storage_key IS NULL AND url IS NOT NULL AND char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://[^[:space:]]+$')
  OR (storage_key IS NOT NULL AND url IS NULL AND kind = 'file' AND size_bytes IS NOT NULL AND mime_type IS NOT NULL));
CREATE UNIQUE INDEX issue_attachments_storage_uq ON issue_attachments (workspace_id, storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX issue_attachments_gc_idx ON issue_attachments (workspace_id, created_at) WHERE upload_status = 'pending' OR deleted_at IS NOT NULL;
GRANT UPDATE (upload_status, sha256, size_bytes, deleted_at) ON issue_attachments TO app_user;
