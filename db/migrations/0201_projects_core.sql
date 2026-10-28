-- Area 2: Projects (Linear parity). Run as OWNER. New columns on projects, plus members, milestones, updates (all FORCE RLS).
CREATE TYPE project_status AS ENUM ('backlog','planned','in_progress','paused','completed','canceled');
CREATE TYPE project_health AS ENUM ('on_track','at_risk','off_track');

ALTER TABLE projects
  ADD COLUMN icon text CHECK (icon IS NULL OR char_length(icon) <= 64),
  ADD COLUMN color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  ADD COLUMN lead_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN status project_status NOT NULL DEFAULT 'backlog',
  ADD COLUMN start_date date, ADD COLUMN target_date date,
  ADD CONSTRAINT projects_dates_chk CHECK (start_date IS NULL OR target_date IS NULL OR target_date >= start_date);

CREATE TABLE project_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE);

CREATE TABLE project_milestones (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 100000), target_date date,
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX project_milestones_project_idx ON project_milestones (workspace_id, project_id);

CREATE TABLE project_updates (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES users(id),
  health project_health NOT NULL, body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX project_updates_project_idx ON project_updates (workspace_id, project_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['project_members','project_milestones','project_updates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members, project_milestones, project_updates TO app_user;
