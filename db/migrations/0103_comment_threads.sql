-- Area 1 / part 3: threaded comments (one level, like Linear), edit + resolve markers, reactions, mentions, issue subscribers.
-- Run as OWNER after 0001. Every new table is workspace-scoped with composite FKs and FORCE RLS (same pattern as 0001).
ALTER TABLE comments ADD COLUMN parent_comment_id uuid;
ALTER TABLE comments ADD COLUMN edited_at timestamptz;
ALTER TABLE comments ADD COLUMN resolved_at timestamptz;
ALTER TABLE comments ADD COLUMN resolved_by uuid REFERENCES users(id);
ALTER TABLE comments ADD CONSTRAINT comments_parent_fk FOREIGN KEY (parent_comment_id, workspace_id)
  REFERENCES comments(id, workspace_id) ON DELETE CASCADE; -- deleting a thread root removes its replies
ALTER TABLE comments ADD CONSTRAINT comments_parent_not_self CHECK (parent_comment_id IS NULL OR parent_comment_id <> id);
ALTER TABLE comments ADD CONSTRAINT comments_resolve_root_only CHECK (resolved_at IS NULL OR parent_comment_id IS NULL);
CREATE INDEX comments_parent_idx ON comments (parent_comment_id, id) WHERE parent_comment_id IS NOT NULL;

-- One level of threading: a reply's parent must be a root comment of the SAME issue. SECURITY INVOKER: runs under RLS.
CREATE FUNCTION comments_check_parent() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE p record;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN RETURN NEW; END IF;
  SELECT issue_id, parent_comment_id INTO p FROM public.comments WHERE id = NEW.parent_comment_id;
  IF NOT FOUND THEN RETURN NEW; END IF; -- FK reports it
  IF p.parent_comment_id IS NOT NULL THEN RAISE EXCEPTION 'comment threads are one level deep' USING ERRCODE = 'check_violation'; END IF;
  IF p.issue_id <> NEW.issue_id THEN RAISE EXCEPTION 'reply must belong to the parent issue' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER comments_parent_check BEFORE INSERT OR UPDATE OF parent_comment_id, issue_id ON comments
  FOR EACH ROW EXECUTE FUNCTION comments_check_parent();

CREATE TABLE comment_reactions (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 32 AND emoji !~ '\s'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji),
  FOREIGN KEY (comment_id, workspace_id) REFERENCES comments(id, workspace_id) ON DELETE CASCADE);

CREATE INDEX comment_reactions_ws_comment_idx ON comment_reactions (workspace_id, comment_id);

CREATE TABLE comment_mentions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (comment_id, user_id),
  FOREIGN KEY (comment_id, workspace_id) REFERENCES comments(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX comment_mentions_user_idx ON comment_mentions (workspace_id, user_id);

-- Who follows an issue (notifications are Area 7). reason: creator|assignee|mention|commenter|manual.
CREATE TABLE issue_subscribers (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  issue_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (reason IN ('creator','assignee','mention','commenter','manual')),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (issue_id, user_id),
  FOREIGN KEY (issue_id, workspace_id) REFERENCES issues(id, workspace_id) ON DELETE CASCADE);
CREATE INDEX issue_subscribers_user_idx ON issue_subscribers (workspace_id, user_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['comment_reactions','comment_mentions','issue_subscribers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON comment_reactions, comment_mentions, issue_subscribers TO app_user;
