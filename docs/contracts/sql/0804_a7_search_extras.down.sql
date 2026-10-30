DROP INDEX IF EXISTS issue_attachments_tsv_idx;
ALTER TABLE issue_attachments DROP COLUMN IF EXISTS tsv;
DROP TABLE IF EXISTS search_recents;
