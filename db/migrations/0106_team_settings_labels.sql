-- Area 9 / Part 2: team estimate settings, label groups and team labels (0106: 0006 is taken by #84).
-- Workflow states live in 0101 (workflow_states, /teams/:id/states) and cycle config in 0301 (team_cycle_settings):
-- neither is duplicated here. issues.estimate (0101) is a smallint 0..64; team_settings.estimate_scale only says which
-- values the UI offers. Every new table: tenant RLS (FORCE), composite tenant FKs, workspace_id-leading indexes (S12).
BEGIN;

CREATE TABLE team_settings (
  team_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  estimate_scale text NOT NULL DEFAULT 'none' CHECK (estimate_scale IN ('none','linear','fibonacci','exponential','tshirt')),
  estimate_allow_zero boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);

-- Label groups: workspace-level (team_id NULL) or team-level. One level of nesting, like Linear.
CREATE TABLE label_groups (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  color text NOT NULL DEFAULT '#888888' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX label_groups_name_uq ON label_groups (workspace_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

ALTER TABLE labels ADD COLUMN team_id uuid, ADD COLUMN group_id uuid,
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  ADD CONSTRAINT labels_team_fk FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE,
  ADD CONSTRAINT labels_group_fk FOREIGN KEY (group_id, workspace_id) REFERENCES label_groups(id, workspace_id) ON DELETE SET NULL (group_id);
-- Name unique per scope (workspace labels vs. each team's labels) instead of per workspace.
DROP INDEX labels_ws_name_uq;
CREATE UNIQUE INDEX labels_scope_name_uq ON labels (workspace_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX labels_group_idx ON labels (workspace_id, group_id) WHERE group_id IS NOT NULL;

-- A team group may only hold that team's labels (a workspace group holds any label of the workspace).
CREATE FUNCTION labels_group_scope_check() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE g_team uuid;
BEGIN
  IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
  SELECT team_id INTO g_team FROM label_groups WHERE id = NEW.group_id;
  IF g_team IS NOT NULL AND g_team IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION 'label group belongs to another team' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER labels_group_scope BEFORE INSERT OR UPDATE OF group_id, team_id ON labels FOR EACH ROW EXECUTE FUNCTION labels_group_scope_check();

-- An issue only carries workspace-level labels or labels of its own team.
CREATE FUNCTION issue_labels_team_check() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE l_team uuid; i_team uuid;
BEGIN
  SELECT team_id INTO l_team FROM labels WHERE id = NEW.label_id;
  IF l_team IS NULL THEN RETURN NEW; END IF;
  SELECT team_id INTO i_team FROM issues WHERE id = NEW.issue_id;
  IF l_team IS DISTINCT FROM i_team THEN
    RAISE EXCEPTION 'label belongs to another team' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issue_labels_team BEFORE INSERT OR UPDATE OF label_id, issue_id ON issue_labels FOR EACH ROW EXECUTE FUNCTION issue_labels_team_check();

-- Default settings row for every team (new and existing). Invoker rights: runs in the creating tx, where
-- app.workspace_id is the team's workspace, so RLS WITH CHECK passes. No SECURITY DEFINER.
CREATE FUNCTION seed_team_defaults(p_team uuid, p_ws uuid) RETURNS void LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO team_settings (team_id, workspace_id) VALUES (p_team, p_ws) ON CONFLICT DO NOTHING;
$$;
CREATE FUNCTION teams_seed_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN PERFORM seed_team_defaults(NEW.id, NEW.workspace_id); RETURN NEW; END $$;
CREATE TRIGGER teams_seed_defaults AFTER INSERT ON teams FOR EACH ROW EXECUTE FUNCTION teams_seed_defaults();

DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_settings','label_groups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
  FOR r IN SELECT id, workspace_id FROM teams LOOP  -- backfill existing teams, per tenant (FORCE RLS)
    PERFORM set_config('app.workspace_id', r.workspace_id::text, true);
    PERFORM seed_team_defaults(r.id, r.workspace_id);
  END LOOP;
  PERFORM set_config('app.workspace_id', '', true);
END $$;

-- S12: every tenant table has an index leading with workspace_id.
CREATE INDEX team_settings_ws_idx ON team_settings (workspace_id);
CREATE INDEX label_groups_ws_idx ON label_groups (workspace_id, team_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON label_groups TO app_user;
GRANT SELECT, INSERT, UPDATE ON team_settings TO app_user;
REVOKE ALL ON FUNCTION seed_team_defaults(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_team_defaults(uuid, uuid) TO app_user;
COMMIT;
