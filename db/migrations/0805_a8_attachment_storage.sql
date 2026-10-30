-- A8: uploaded files. Link/file rows with an https url keep working; an upload sets storage_key and no url.
ALTER TABLE issue_attachments
  ADD COLUMN storage_key text,
  ADD COLUMN sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN upload_status text NOT NULL DEFAULT 'ready' CHECK (upload_status IN ('pending','uploading','ready')),
  ADD COLUMN filename text CHECK (filename IS NULL OR char_length(filename) BETWEEN 1 AND 255),
  ADD COLUMN upload_started_at timestamptz, -- set while upload_status = 'uploading' (bytes are being streamed, no transaction open)
  ADD COLUMN deleted_at timestamptz;
ALTER TABLE issue_attachments DROP CONSTRAINT issue_attachments_url_check;
ALTER TABLE issue_attachments ALTER COLUMN url DROP NOT NULL;
ALTER TABLE issue_attachments ADD CONSTRAINT issue_attachments_url_check CHECK (
  (storage_key IS NULL AND url IS NOT NULL AND char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://[^[:space:]]+$')
  OR (storage_key IS NOT NULL AND url IS NULL AND kind = 'file' AND size_bytes IS NOT NULL AND mime_type IS NOT NULL));
CREATE UNIQUE INDEX issue_attachments_storage_uq ON issue_attachments (workspace_id, storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX issue_attachments_gc_idx ON issue_attachments (workspace_id, created_at) WHERE upload_status <> 'ready' OR deleted_at IS NOT NULL;
GRANT UPDATE (upload_status, upload_started_at, sha256, size_bytes, deleted_at) ON issue_attachments TO app_user;

-- GC for uploads: pending rows older than 1 h, 'uploading' rows stuck for more than 15 min (a crashed PUT) and soft-deleted rows older than 10 min are removed and their storage keys handed
-- back to the caller (the app deletes the bytes). SECURITY DEFINER: app_user cannot see other tenants' rows.
CREATE FUNCTION attachments_gc_claim(lim integer DEFAULT 200) RETURNS TABLE (workspace_id uuid, storage_key text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  DELETE FROM public.issue_attachments a WHERE a.id IN (
    SELECT g.id FROM public.issue_attachments g WHERE g.storage_key IS NOT NULL
      AND ((g.upload_status = 'pending' AND g.created_at < now() - interval '1 hour')
        OR (g.upload_status = 'uploading' AND g.upload_started_at < now() - interval '15 minutes')
        OR g.deleted_at < now() - interval '10 minutes')
    LIMIT greatest(1, least(lim, 1000)) FOR UPDATE SKIP LOCKED)
  RETURNING a.workspace_id, a.storage_key $$;
GRANT CREATE ON SCHEMA public TO definer;
ALTER FUNCTION attachments_gc_claim(integer) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT, UPDATE, DELETE ON issue_attachments TO definer; -- UPDATE: FOR UPDATE SKIP LOCKED needs it
REVOKE ALL ON FUNCTION attachments_gc_claim(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attachments_gc_claim(integer) TO app_user;
