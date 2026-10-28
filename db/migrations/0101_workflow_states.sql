-- Area 1 / part 1: per-team workflow states, issue estimate and due date. Run as the OWNER role, after 0005.
-- issues.status (enum) stays as the backward-compatible view of the state: a trigger keeps status and state_id in sync
-- in both directions, so legacy clients writing `status` and new clients writing `state_id` see the same issue.
CREATE TYPE workflow_state_category AS ENUM ('backlog','unstarted','started','completed','canceled');

CREATE TABLE workflow_states (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL, name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  color text NOT NULL DEFAULT '#888888' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  category workflow_state_category NOT NULL, position double precision NOT NULL,
  -- Internal: the legacy status this state maps to (seeded states only). NULL => the category's default status.
  legacy_status issue_status,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id), UNIQUE (id, team_id),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX workflow_states_team_name_uq ON workflow_states (team_id, lower(name));
CREATE INDEX workflow_states_team_pos_idx ON workflow_states (team_id, position);

-- Category default for a state without legacy_status.
CREATE FUNCTION workflow_state_status(c workflow_state_category, legacy issue_status) RETURNS issue_status
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(legacy, CASE c WHEN 'backlog' THEN 'backlog' WHEN 'unstarted' THEN 'todo' WHEN 'started' THEN 'in_progress'
    WHEN 'completed' THEN 'done' ELSE 'canceled' END::issue_status) $$;

-- The 6 default states, one per legacy status. SECURITY INVOKER: runs under the caller's RLS (workspace setting).
CREATE FUNCTION seed_workflow_states(p_team uuid, p_ws uuid) RETURNS void LANGUAGE sql SET search_path = pg_catalog, public AS $$
  INSERT INTO workflow_states (id, workspace_id, team_id, name, color, category, position, legacy_status)
  SELECT gen_random_uuid(), p_ws, p_team, s.name, s.color, s.cat::workflow_state_category, s.pos, s.st::issue_status
  FROM (VALUES ('Backlog','#bec2c8','backlog',1,'backlog'), ('Todo','#e2e2e2','unstarted',2,'todo'),
    ('In Progress','#f2c94c','started',3,'in_progress'), ('In Review','#5e6ad2','started',4,'in_review'),
    ('Done','#5e6ad2','completed',5,'done'), ('Canceled','#95a2b3','canceled',6,'canceled')) AS s(name, color, cat, pos, st) $$;

CREATE FUNCTION teams_seed_states() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN PERFORM seed_workflow_states(NEW.id, NEW.workspace_id); RETURN NULL; END $$;
CREATE TRIGGER teams_seed_states AFTER INSERT ON teams FOR EACH ROW EXECUTE FUNCTION teams_seed_states();

ALTER TABLE issues ADD COLUMN state_id uuid, ADD COLUMN estimate smallint CHECK (estimate BETWEEN 0 AND 64), ADD COLUMN due_date date;
ALTER TABLE issues ADD CONSTRAINT issues_state_team_fk FOREIGN KEY (state_id, team_id) REFERENCES workflow_states(id, team_id);
CREATE INDEX issues_state_idx ON issues (state_id) WHERE deleted_at IS NULL;
CREATE INDEX issues_due_idx ON issues (workspace_id, due_date) WHERE deleted_at IS NULL AND due_date IS NOT NULL;

-- status <-> state_id sync. A state_id change wins; a status-only change keeps the current state when it already maps
-- to that status, else picks the team's state for that status (seeded mapping first, then first of the category).
CREATE FUNCTION issues_sync_state() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE s record; cat workflow_state_category;
BEGIN
  IF NEW.state_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.state_id IS DISTINCT FROM OLD.state_id) THEN
    SELECT category, legacy_status INTO s FROM workflow_states WHERE id = NEW.state_id AND team_id = NEW.team_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'state does not belong to the issue team' USING ERRCODE = 'foreign_key_violation'; END IF;
    NEW.status := workflow_state_status(s.category, s.legacy_status);
    RETURN NEW;
  END IF;
  IF NEW.state_id IS NOT NULL THEN
    SELECT category, legacy_status INTO s FROM workflow_states WHERE id = NEW.state_id;
    IF FOUND AND workflow_state_status(s.category, s.legacy_status) = NEW.status THEN RETURN NEW; END IF;
  END IF;
  cat := CASE NEW.status WHEN 'backlog' THEN 'backlog' WHEN 'todo' THEN 'unstarted' WHEN 'in_progress' THEN 'started'
    WHEN 'in_review' THEN 'started' WHEN 'done' THEN 'completed' ELSE 'canceled' END;
  SELECT id INTO NEW.state_id FROM workflow_states WHERE team_id = NEW.team_id AND category = cat
    ORDER BY (legacy_status = NEW.status) DESC NULLS LAST, position, id LIMIT 1;
  IF NEW.state_id IS NULL THEN RAISE EXCEPTION 'team has no workflow state for status %', NEW.status USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issues_sync_state BEFORE INSERT OR UPDATE OF status, state_id, team_id ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_sync_state();

-- Backfill as owner: FORCE RLS would hide every row, so lift FORCE for the duration of this transaction only.
ALTER TABLE teams NO FORCE ROW LEVEL SECURITY;
ALTER TABLE issues NO FORCE ROW LEVEL SECURITY;
SELECT seed_workflow_states(t.id, t.workspace_id) FROM teams t;
UPDATE issues SET status = status; -- trigger derives state_id
ALTER TABLE issues FORCE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
ALTER TABLE issues ALTER COLUMN state_id SET NOT NULL;

ALTER TABLE workflow_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_states FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_states
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_states TO app_user;
GRANT EXECUTE ON FUNCTION seed_workflow_states(uuid, uuid), workflow_state_status(workflow_state_category, issue_status) TO app_user;
