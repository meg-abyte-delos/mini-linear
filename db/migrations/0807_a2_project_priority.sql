-- Project priority (0 none, 1 urgent .. 4 low), same scale as issues; the projects list shows it as a column.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4);
