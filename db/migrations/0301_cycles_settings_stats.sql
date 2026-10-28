-- Area 3 (Cycles): per-team settings, daily scope snapshots (burn-up), cycle numbering, issue/cycle team guard.
ALTER TABLE cycles ADD COLUMN number integer CHECK (number IS NULL OR number > 0);
UPDATE cycles c SET number = r.n FROM (SELECT id, row_number() OVER (PARTITION BY team_id ORDER BY start_date, id) AS n FROM cycles) r WHERE r.id = c.id;
ALTER TABLE cycles ADD COLUMN completed_at timestamptz; -- explicit close (POST /cycles/:id/complete); status upcoming/active/completed is derived
CREATE UNIQUE INDEX cycles_team_number_uq ON cycles (team_id, number) WHERE number IS NOT NULL;

CREATE TABLE team_cycle_settings (
  team_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  duration_days integer NOT NULL DEFAULT 14 CHECK (duration_days BETWEEN 1 AND 90),
  cooldown_days integer NOT NULL DEFAULT 0 CHECK (cooldown_days BETWEEN 0 AND 30),
  start_weekday smallint NOT NULL DEFAULT 1 CHECK (start_weekday BETWEEN 0 AND 6), -- 0 = Sunday .. 6 = Saturday
  upcoming_count integer NOT NULL DEFAULT 2 CHECK (upcoming_count BETWEEN 1 AND 6),
  auto_rollover boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);

CREATE INDEX team_cycle_settings_team_idx ON team_cycle_settings (workspace_id, team_id); -- S12: workspace_id leads every index

-- One row per cycle per day: scope = issues in the cycle, started = in_progress/in_review, completed = done.
CREATE TABLE cycle_snapshots (
  cycle_id uuid NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day date NOT NULL, scope integer NOT NULL CHECK (scope >= 0), started integer NOT NULL CHECK (started >= 0), completed integer NOT NULL CHECK (completed >= 0),
  PRIMARY KEY (cycle_id, day),
  FOREIGN KEY (cycle_id, workspace_id) REFERENCES cycles(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX cycle_snapshots_cycle_idx ON cycle_snapshots (workspace_id, cycle_id, day); -- S12

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['team_cycle_settings','cycle_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_cycle_settings, cycle_snapshots TO app_user;

-- An issue may only sit in a cycle of its own team. SECURITY INVOKER: runs under RLS.
CREATE FUNCTION issues_check_cycle_team() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.cycle_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id)
     AND EXISTS (SELECT 1 FROM public.cycles c WHERE c.id = NEW.cycle_id AND c.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cannot add an issue to a completed cycle' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.cycle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cycles c WHERE c.id = NEW.cycle_id AND c.team_id = NEW.team_id) THEN
    RAISE EXCEPTION 'issue cycle belongs to another team' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issues_cycle_team_check BEFORE INSERT OR UPDATE OF cycle_id, team_id ON issues
  FOR EACH ROW EXECUTE FUNCTION issues_check_cycle_team();
