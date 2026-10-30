-- A7 (contract docs/contracts/A7-search.md): recent searches per user, searchable attachment titles, and search_workspace v3
-- (more filters, attachment kind, sort=updated, updated_at / parent_identifier / matched, HTML-escaped snippets).
-- No extension (pg_trgm deliberately avoided). Down: db/migrations/down/0804_a7_search_extras.down.sql.
CREATE TABLE search_recents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('query','issue','project')),
  query text CHECK (query IS NULL OR char_length(query) BETWEEN 1 AND 200),
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'query') = (query IS NOT NULL AND entity_id IS NULL)));
CREATE INDEX search_recents_user_idx ON search_recents (workspace_id, user_id, created_at DESC);
ALTER TABLE search_recents ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_recents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search_recents USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
CREATE POLICY own_rows ON search_recents AS RESTRICTIVE USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON search_recents TO app_user;
ALTER TABLE issue_attachments ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, ''))) STORED;
CREATE INDEX issue_attachments_tsv_idx ON issue_attachments USING gin (tsv);

-- Snippet (XSS-safe): ts_headline between private-use sentinels (U+E000 / U+E001, stripped from the source first), then everything
-- is HTML-escaped, then the sentinels become <mark> / </mark>. Only our own mark tags are live in the result.
CREATE FUNCTION search_snippet(src text, tq tsquery) RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT replace(replace(replace(replace(replace(replace(
    ts_headline('simple', translate(coalesce(src, ''), U&'\E000\E001', ''), tq, U&'StartSel=\E000,StopSel=\E001,MaxFragments=1,MaxWords=20,MinWords=8'),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), U&'\E000', '<mark>'), U&'\E001', '</mark>') $$;
GRANT EXECUTE ON FUNCTION search_snippet(text, tsquery) TO app_user;

-- An attachment is searchable when it is not soft-deleted and ready (links are ready; a pending upload is never a hit).
-- Reads the A8 columns (0805: deleted_at, upload_status) through jsonb so this migration also works before 0805 exists.
CREATE FUNCTION search_attachment_live(a issue_attachments) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT to_jsonb(a) ->> 'deleted_at' IS NULL AND coalesce(to_jsonb(a) ->> 'upload_status', 'ready') = 'ready' $$;
GRANT EXECUTE ON FUNCTION search_attachment_live(issue_attachments) TO app_user;

-- Which of these entities (kind issue|project) may the caller see? Same rules as search_workspace. Identity from the session.
CREATE FUNCTION search_visible_entities(p_kind text, p_ids uuid[]) RETURNS TABLE (id uuid) LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  p_user uuid := nullif(current_setting('app.user_id', true), '')::uuid; p_role text;
BEGIN
  SELECT m.role::text INTO p_role FROM memberships m WHERE m.user_id = p_user AND m.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid;
  IF p_role IS NULL THEN RETURN; END IF;
  IF p_kind = 'issue' THEN
    RETURN QUERY SELECT i.id FROM issues i WHERE i.id = ANY (p_ids) AND i.deleted_at IS NULL AND CASE
      WHEN p_role IN ('owner', 'admin') THEN true
      WHEN p_role = 'guest' THEN EXISTS (SELECT 1 FROM issue_shares s WHERE s.issue_id = i.id AND s.guest_user_id = p_user AND s.revoked_at IS NULL)
      ELSE EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = i.team_id AND tm.user_id = p_user) END;
  ELSIF p_kind = 'project' AND p_role <> 'guest' THEN
    RETURN QUERY SELECT p.id FROM projects p WHERE p.id = ANY (p_ids) AND (p_role IN ('owner', 'admin') OR EXISTS (
      SELECT 1 FROM project_teams pt JOIN team_memberships tm ON tm.team_id = pt.team_id AND tm.workspace_id = pt.workspace_id WHERE pt.project_id = p.id AND tm.user_id = p_user));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION search_visible_entities(text, uuid[]) TO app_user;

-- search_workspace v3. New params are appended after the 10 existing ones (old positional calls keep working).
DROP FUNCTION search_workspace(text, text[], integer, issue_status, uuid, uuid, uuid, uuid, double precision, uuid);
CREATE FUNCTION search_workspace(
  q text, p_kinds text[] DEFAULT '{issue,comment,project}', p_limit integer DEFAULT 20,
  p_status issue_status DEFAULT NULL, p_team uuid DEFAULT NULL, p_assignee uuid DEFAULT NULL, p_project uuid DEFAULT NULL, p_label uuid DEFAULT NULL,
  p_after_rank double precision DEFAULT NULL, p_after_id uuid DEFAULT NULL,
  p_priority smallint DEFAULT NULL, p_cycle uuid DEFAULT NULL, p_state uuid DEFAULT NULL, p_due_before date DEFAULT NULL, p_due_after date DEFAULT NULL,
  p_has_attachment boolean DEFAULT NULL, p_include_done boolean DEFAULT true, p_sort text DEFAULT 'rank', p_after_ts timestamptz DEFAULT NULL)
RETURNS TABLE (kind text, id uuid, issue_id uuid, identifier text, title text, snippet text, rank double precision,
               status issue_status, team_id uuid, project_id uuid, assignee_id uuid,
               updated_at timestamptz, parent_identifier text, matched text[], updated_key text)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public SET client_min_messages = error AS $$
DECLARE
  tq tsquery; pre tsquery; tok text; ident text[]; lim integer := least(greatest(coalesce(p_limit, 20), 1), 101);
  p_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  p_role text; admin boolean; guest boolean;
  issue_filter boolean := p_status IS NOT NULL OR p_assignee IS NOT NULL OR p_label IS NOT NULL OR p_priority IS NOT NULL OR p_cycle IS NOT NULL
    OR p_state IS NOT NULL OR p_due_before IS NOT NULL OR p_due_after IS NOT NULL OR p_has_attachment IS NOT NULL OR p_include_done IS FALSE;
BEGIN
  SELECT m.role::text INTO p_role FROM memberships m WHERE m.user_id = p_user AND m.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid;
  admin := p_role IN ('owner', 'admin'); guest := p_role = 'guest';
  IF p_role IS NULL THEN RETURN; END IF;
  q := coalesce(q, '');
  tok := (regexp_match(q, '(?:^|[[:space:]])([[:alnum:]]{2,})[[:space:]]*$'))[1];
  IF tok IS NOT NULL AND lower(tok) <> 'or' THEN
    tq := websearch_to_tsquery('simple', left(q, length(rtrim(q)) - length(tok)));
    pre := to_tsquery('simple', quote_literal(tok) || ':*');
    tq := CASE WHEN numnode(tq) = 0 THEN pre ELSE tq && pre END;
  ELSE
    tq := websearch_to_tsquery('simple', q);
  END IF;
  ident := regexp_match(q, '^[[:space:]]*([A-Za-z]{2,5})-([0-9]+)[[:space:]]*$');

  RETURN QUERY
  WITH vis_issues AS (
    SELECT i.*, t.key AS team_key FROM issues i JOIN teams t ON t.id = i.team_id AND t.workspace_id = i.workspace_id
    WHERE i.deleted_at IS NULL
      AND CASE WHEN admin THEN true
               WHEN guest THEN EXISTS (SELECT 1 FROM issue_shares s WHERE s.issue_id = i.id AND s.guest_user_id = p_user AND s.revoked_at IS NULL)
               ELSE EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = i.team_id AND tm.user_id = p_user) END
      AND (p_status IS NULL OR i.status = p_status) AND (p_team IS NULL OR i.team_id = p_team)
      AND (p_assignee IS NULL OR i.assignee_id = p_assignee) AND (p_project IS NULL OR i.project_id = p_project)
      AND (p_label IS NULL OR EXISTS (SELECT 1 FROM issue_labels l WHERE l.issue_id = i.id AND l.label_id = p_label))
      AND (p_priority IS NULL OR i.priority = p_priority) AND (p_cycle IS NULL OR i.cycle_id = p_cycle) AND (p_state IS NULL OR i.state_id = p_state)
      AND (p_due_before IS NULL OR i.due_date <= p_due_before) AND (p_due_after IS NULL OR i.due_date >= p_due_after)
      AND (p_has_attachment IS NULL OR p_has_attachment = EXISTS (SELECT 1 FROM issue_attachments a WHERE a.issue_id = i.id AND a.workspace_id = i.workspace_id AND search_attachment_live(a)))
      AND (p_include_done IS NOT FALSE OR i.status NOT IN ('done', 'canceled'))
  ), hits AS (
    SELECT 'issue'::text AS k, i.id, i.id AS iid, i.team_key || '-' || i.number AS ident, i.title AS ttl,
           search_snippet(i.title || ' ' || i.description, tq) AS snip,
           (ts_rank_cd(i.tsv, tq) + CASE WHEN ident IS NOT NULL AND i.team_key = upper(ident[1]) AND i.number = ident[2]::integer THEN 1000000 ELSE 0 END)::double precision AS rk,
           i.status AS st, i.team_id AS tid, i.project_id AS pid, i.assignee_id AS aid, i.updated_at AS upd,
           (SELECT pt.key || '-' || pi.number FROM issues pi JOIN teams pt ON pt.id = pi.team_id AND pt.workspace_id = pi.workspace_id
             WHERE pi.id = i.parent_id AND pi.workspace_id = i.workspace_id AND pi.deleted_at IS NULL AND CASE WHEN admin THEN true
               WHEN guest THEN EXISTS (SELECT 1 FROM issue_shares s WHERE s.issue_id = pi.id AND s.guest_user_id = p_user AND s.revoked_at IS NULL)
               ELSE EXISTS (SELECT 1 FROM team_memberships tm WHERE tm.team_id = pi.team_id AND tm.user_id = p_user) END) AS pident,
           ARRAY(SELECT x FROM (VALUES (1, 'title', to_tsvector('simple', i.title) @@ tq), (2, 'description', to_tsvector('simple', i.description) @@ tq)) v(o, x, hit) WHERE hit ORDER BY o) AS mt
    FROM vis_issues i WHERE 'issue' = ANY (p_kinds)
      AND (i.tsv @@ tq OR (ident IS NOT NULL AND i.team_key = upper(ident[1]) AND i.number = ident[2]::integer))
    UNION ALL
    SELECT 'comment', c.id, i.id, i.team_key || '-' || i.number, i.title,
           search_snippet(c.body, tq),
           (ts_rank_cd(c.tsv, tq) * 0.5)::double precision, i.status, i.team_id, i.project_id, i.assignee_id, c.updated_at, NULL::text, ARRAY['comment']
    FROM comments c JOIN vis_issues i ON i.id = c.issue_id AND i.workspace_id = c.workspace_id
    WHERE 'comment' = ANY (p_kinds) AND c.tsv @@ tq
    UNION ALL
    SELECT 'attachment', a.id, i.id, i.team_key || '-' || i.number, a.title,
           search_snippet(a.title, tq),
           (ts_rank_cd(a.tsv, tq) * 0.5)::double precision, i.status, i.team_id, i.project_id, i.assignee_id, a.created_at, NULL::text, ARRAY['attachment']
    FROM issue_attachments a JOIN vis_issues i ON i.id = a.issue_id AND i.workspace_id = a.workspace_id
    WHERE 'attachment' = ANY (p_kinds) AND a.tsv @@ tq AND search_attachment_live(a)
    UNION ALL
    SELECT 'project', p.id, NULL::uuid, NULL::text, p.name,
           search_snippet(p.name || ' ' || p.description, tq),
           ts_rank_cd(p.tsv, tq)::double precision, NULL::issue_status, NULL::uuid, p.id, NULL::uuid, p.updated_at, NULL::text,
           ARRAY(SELECT x FROM (VALUES (1, 'title', to_tsvector('simple', p.name) @@ tq), (2, 'description', to_tsvector('simple', p.description) @@ tq)) v(o, x, hit) WHERE hit ORDER BY o)
    FROM projects p
    WHERE 'project' = ANY (p_kinds) AND NOT guest AND NOT issue_filter AND p.tsv @@ tq
      AND (p_project IS NULL OR p.id = p_project)
      AND (p_team IS NULL OR EXISTS (SELECT 1 FROM project_teams pt WHERE pt.project_id = p.id AND pt.team_id = p_team))
      AND (admin OR EXISTS (SELECT 1 FROM project_teams pt JOIN team_memberships tm ON tm.team_id = pt.team_id AND tm.workspace_id = pt.workspace_id
                            WHERE pt.project_id = p.id AND tm.user_id = p_user))
  )
  SELECT h.k, h.id, h.iid, h.ident, h.ttl, h.snip, h.rk, h.st, h.tid, h.pid, h.aid, h.upd, h.pident,
         CASE WHEN cardinality(h.mt) = 0 THEN ARRAY['title'] ELSE h.mt END,
         to_char(h.upd AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM hits h
  WHERE CASE WHEN p_sort = 'updated' THEN (p_after_ts IS NULL OR h.upd < p_after_ts OR (h.upd = p_after_ts AND h.id > p_after_id))
             ELSE (p_after_rank IS NULL OR h.rk < p_after_rank OR (h.rk = p_after_rank AND h.id > p_after_id)) END
  ORDER BY CASE WHEN p_sort = 'updated' THEN NULL ELSE h.rk END DESC NULLS LAST, CASE WHEN p_sort = 'updated' THEN h.upd END DESC NULLS LAST, h.id ASC LIMIT lim;
END $$;
GRANT EXECUTE ON FUNCTION search_workspace(text, text[], integer, issue_status, uuid, uuid, uuid, uuid, double precision, uuid, smallint, uuid, uuid, date, date, boolean, boolean, text, timestamptz) TO app_user;
