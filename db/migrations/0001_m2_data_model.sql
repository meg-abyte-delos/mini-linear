-- M2 data model (spec v1 s2 + v1.1 2.8/2.9/2.10). Run as the OWNER role, after 0000. Every table carries workspace_id,
-- FORCE RLS (USING + WITH CHECK), and child rows point at parents through composite (id, workspace_id) FKs so a row
-- can never reference another tenant's parent (FK checks bypass RLS).
CREATE EXTENSION IF NOT EXISTS btree_gist; -- trusted extension; needed for the cycle no-overlap exclusion constraint

-- Teams get a key (2-5 uppercase letters, unique per workspace) and an atomic per-team issue counter.
ALTER TABLE teams ADD COLUMN key text NOT NULL CHECK (key ~ '^[A-Z]{2,5}$');
ALTER TABLE teams ADD COLUMN issue_seq integer NOT NULL DEFAULT 0;
ALTER TABLE teams ADD CONSTRAINT teams_ws_key_uq UNIQUE (workspace_id, key);

CREATE TYPE issue_status AS ENUM ('backlog','todo','in_progress','in_review','done','canceled');

CREATE TABLE projects (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255), description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 100000),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id));
-- Projects can span teams: visible when the caller belongs to at least one of them (enforced in the API layer).
CREATE TABLE project_teams (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL, team_id uuid NOT NULL, PRIMARY KEY (project_id, team_id),
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);

CREATE TABLE cycles (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL, name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  start_date date NOT NULL, end_date date NOT NULL, CHECK (end_date >= start_date),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE,
  -- no overlap within a team; both bounds inclusive
  CONSTRAINT cycles_no_overlap EXCLUDE USING gist (team_id WITH =, daterange(start_date, end_date, '[]') WITH &&));

CREATE TABLE labels ( -- workspace-wide (v1.1 2.9)
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64), color text NOT NULL DEFAULT '#888888' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id));
CREATE UNIQUE INDEX labels_ws_name_uq ON labels (workspace_id, lower(name));

CREATE TABLE issues (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL, number integer NOT NULL CHECK (number > 0), -- identifier = teams.key || '-' || number, never reused
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 100000),
  status issue_status NOT NULL DEFAULT 'backlog', priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  assignee_id uuid REFERENCES users(id), project_id uuid, cycle_id uuid, parent_id uuid,
  sort_key text NOT NULL COLLATE "C", version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id), deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id), UNIQUE (team_id, number),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE SET NULL (project_id),
  FOREIGN KEY (cycle_id, workspace_id) REFERENCES cycles(id, workspace_id) ON DELETE SET NULL (cycle_id),
  FOREIGN KEY (parent_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE SET NULL (parent_id));
CREATE INDEX issues_list_idx ON issues (workspace_id, team_id, status, sort_key, id) WHERE deleted_at IS NULL;
CREATE INDEX issues_parent_idx ON issues (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX issues_assignee_idx ON issues (workspace_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX issues_deleted_idx ON issues (deleted_at) WHERE deleted_at IS NOT NULL; -- daily purge (30 days)

CREATE TABLE issue_labels (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, label_id uuid NOT NULL, PRIMARY KEY (issue_id, label_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (label_id, workspace_id) REFERENCES labels(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_labels_label_idx ON issue_labels (label_id);

CREATE TABLE comments (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, author_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 100000),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX comments_issue_idx ON comments (issue_id, created_at, id);

-- v1.1 2.8: a guest sees exactly the issues with an active share.
CREATE TABLE issue_shares (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, guest_user_id uuid NOT NULL REFERENCES users(id),
  shared_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
  PRIMARY KEY (issue_id, guest_user_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_shares_guest_idx ON issue_shares (workspace_id, guest_user_id) WHERE revoked_at IS NULL;

-- v1.1 2.10: one request = one transaction = one audit event listing every changed field. Append-only.
CREATE TABLE audit_events (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id), entity text NOT NULL, entity_id uuid, action text NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb, -- {field: {before, after}}; never hashes/tokens/secrets (app-side redaction)
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_events_list_idx ON audit_events (workspace_id, created_at DESC, id DESC);

-- Parent chain: no cycles, max depth 5 (counting the node and its whole subtree). SECURITY INVOKER: runs under RLS.
CREATE FUNCTION issues_check_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE up integer; down integer; is_cycle boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id = NEW.id THEN RAISE EXCEPTION 'issue parent cycle' USING ERRCODE = 'check_violation'; END IF;
  WITH RECURSIVE anc(id, parent_id, d) AS (
    SELECT id, parent_id, 1 FROM public.issues WHERE id = NEW.parent_id
    UNION ALL SELECT i.id, i.parent_id, a.d + 1 FROM public.issues i JOIN anc a ON i.id = a.parent_id WHERE a.d < 10)
  SELECT coalesce(max(d), 0), coalesce(bool_or(id = NEW.id), false) INTO up, is_cycle FROM anc;
  IF is_cycle THEN RAISE EXCEPTION 'issue parent cycle' USING ERRCODE = 'check_violation'; END IF;
  WITH RECURSIVE dsc(id, d) AS (
    SELECT id, 1 FROM public.issues WHERE parent_id = NEW.id
    UNION ALL SELECT i.id, x.d + 1 FROM public.issues i JOIN dsc x ON i.parent_id = x.id WHERE x.d < 10)
  SELECT coalesce(max(d), 0) INTO down FROM dsc;
  IF up + 1 + down > 5 THEN RAISE EXCEPTION 'issue parent depth exceeds 5' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issues_parent_check BEFORE INSERT OR UPDATE OF parent_id ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_check_parent();

-- RLS on every new tenant table: ENABLE + FORCE, USING + WITH CHECK, unset setting => zero rows.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_teams','cycles','labels','issues','issue_labels','comments','issue_shares','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Grants. Issues are never hard-deleted by app_user (soft delete; purge runs as owner). audit_events is append-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON projects, project_teams, cycles, labels, issue_labels, comments TO app_user;
GRANT SELECT, INSERT, UPDATE ON issues, issue_shares TO app_user;
GRANT SELECT, INSERT ON audit_events TO app_user;
