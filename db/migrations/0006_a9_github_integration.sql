-- Area 9 / Part 4: GitHub integration. Run as the OWNER role, after 0005.
-- NOTE for merge: sibling branches may also add a 0006_* file; numbering is lexical, rename at merge if needed.
-- Per-workspace connection: the webhook secret lives server-side only. app_user can write it but can only READ the
-- non-secret columns (column grants); the webhook endpoint (no session, no tenant yet) reads it through the narrow
-- SECURITY DEFINER github_webhook_target(), like resolve_workspace()/lookup_invite().
CREATE TABLE github_connections (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  webhook_secret text NOT NULL CHECK (char_length(webhook_secret) >= 32),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), rotated_at timestamptz NOT NULL DEFAULT now());

-- Per-team automation. NULL target = do not move. Defaults mirror Linear: PR opened -> In Progress, merged -> Done.
CREATE TABLE github_team_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL PRIMARY KEY,
  on_pr_open issue_status DEFAULT 'in_progress', on_pr_review issue_status DEFAULT 'in_review',
  on_pr_merge issue_status DEFAULT 'done',
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, workspace_id) REFERENCES teams(id, workspace_id) ON DELETE CASCADE);

CREATE TABLE issue_pr_links (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL,
  repo_full_name text NOT NULL CHECK (repo_full_name ~ '^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$'),
  pr_number integer NOT NULL CHECK (pr_number > 0),
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 2048),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 1024),
  head_branch text NOT NULL DEFAULT '' CHECK (char_length(head_branch) <= 512),
  state text NOT NULL CHECK (state IN ('draft','open','closed','merged')),
  linked_via text NOT NULL CHECK (linked_via IN ('branch','magic_word','mention')),
  closes boolean NOT NULL, -- branch / magic word: merging completes the issue; a bare mention only links
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issue_id, repo_full_name, pr_number),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_pr_links_pr_idx ON issue_pr_links (workspace_id, repo_full_name, pr_number);

-- Idempotency: GitHub retries deliveries with the same X-GitHub-Delivery id.
CREATE TABLE github_webhook_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delivery_id text NOT NULL CHECK (char_length(delivery_id) BETWEEN 1 AND 100),
  event text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, delivery_id));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['github_connections','github_team_settings','issue_pr_links','github_webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- SECURITY NOTE: unauthenticated by design (GitHub calls it). Returns the secret for ONE connection id so the caller
-- can verify the HMAC; the caller MUST reject the request unless the signature matches. Connection ids are UUIDs
-- (unguessable); a wrong id returns zero rows.
CREATE FUNCTION github_webhook_target(p_connection_id uuid)
RETURNS TABLE (workspace_id uuid, webhook_secret text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT c.workspace_id, c.webhook_secret FROM public.github_connections c WHERE c.id = p_connection_id $$;

GRANT USAGE, CREATE ON SCHEMA public TO definer;
ALTER FUNCTION github_webhook_target(uuid) OWNER TO definer;
REVOKE CREATE ON SCHEMA public FROM definer;
GRANT SELECT ON github_connections TO definer;
REVOKE ALL ON FUNCTION github_webhook_target(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION github_webhook_target(uuid) TO app_user;

GRANT SELECT (id, workspace_id, created_by, created_at, rotated_at) ON github_connections TO app_user;
GRANT INSERT, UPDATE, DELETE ON github_connections TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON github_team_settings, issue_pr_links TO app_user;
GRANT SELECT, INSERT ON github_webhook_deliveries TO app_user;
