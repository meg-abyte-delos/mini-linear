-- Area 8 slice 2 (Rex nits): search_workspace no longer takes p_role / p_user (any app_user could pass 'owner').
-- Identity = app.user_id + app.workspace_id session settings; role looked up in memberships. Query with no lexemes gives an empty result; client_min_messages=error on the function silences the tsquery NOTICE.
DROP FUNCTION search_workspace(text, uuid, text, text[], integer, issue_status, uuid, uuid, uuid, uuid, double precision, uuid);
CREATE FUNCTION search_workspace(
  q text, p_kinds text[] DEFAULT '{issue,comment,project}', p_limit integer DEFAULT 20,
  p_status issue_status DEFAULT NULL, p_team uuid DEFAULT NULL, p_assignee uuid DEFAULT NULL, p_project uuid DEFAULT NULL, p_label uuid DEFAULT NULL,
  p_after_rank double precision DEFAULT NULL, p_after_id uuid DEFAULT NULL)
RETURNS TABLE (kind text, id uuid, issue_id uuid, identifier text, title text, snippet text, rank double precision,
               status issue_status, team_id uuid, project_id uuid, assignee_id uuid)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public SET client_min_messages = error AS $$
DECLARE
  tq tsquery; pre tsquery; tok text; ident text[]; lim integer := least(greatest(coalesce(p_limit, 20), 1), 101);
  p_user uuid := nullif(current_setting('app.user_id', true), '')::uuid;
  p_role text; admin boolean; guest boolean;
  issue_filter boolean := p_status IS NOT NULL OR p_assignee IS NOT NULL OR p_label IS NOT NULL;
BEGIN
  -- identity comes from the session (set by withWorkspaceCtx), never from arguments; the role is read from memberships
  -- (FORCE RLS: only the current workspace is visible), so a caller cannot ask for owner visibility.
  SELECT m.role::text INTO p_role FROM memberships m WHERE m.user_id = p_user AND m.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid;
  admin := p_role IN ('owner', 'admin'); guest := p_role = 'guest';
  IF p_role IS NULL THEN RETURN; END IF;
  -- prefix match on the last token (alphanumerics only, so nothing can inject tsquery syntax), unless it is negated or an operator.
  -- That token is dropped from the websearch part: ANDing 'quok' with 'quok':* would defeat the prefix.
  tok := (regexp_match(coalesce(q, ''), '(?:^|[[:space:]])([[:alnum:]]{2,})[[:space:]]*$'))[1];
  IF tok IS NOT NULL AND lower(tok) <> 'or' THEN
    tq := websearch_to_tsquery('simple', left(q, length(rtrim(q)) - length(tok)));
    pre := to_tsquery('simple', quote_literal(tok) || ':*');
    tq := CASE WHEN numnode(tq) = 0 THEN pre ELSE tq && pre END;
  ELSE
    tq := websearch_to_tsquery('simple', coalesce(q, ''));
  END IF;
  ident := regexp_match(coalesce(q, ''), '^[[:space:]]*([A-Za-z]{2,5})-([0-9]+)[[:space:]]*$');

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
  ), hits AS (
    SELECT 'issue'::text AS k, i.id, i.id AS iid, i.team_key || '-' || i.number AS ident, i.title AS ttl,
           ts_headline('simple', i.title || ' ' || i.description, tq, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=8') AS snip,
           (ts_rank_cd(i.tsv, tq) + CASE WHEN ident IS NOT NULL AND i.team_key = upper(ident[1]) AND i.number = ident[2]::integer THEN 1000000 ELSE 0 END)::double precision AS rk,
           i.status AS st, i.team_id AS tid, i.project_id AS pid, i.assignee_id AS aid
    FROM vis_issues i WHERE 'issue' = ANY (p_kinds)
      AND (i.tsv @@ tq OR (ident IS NOT NULL AND i.team_key = upper(ident[1]) AND i.number = ident[2]::integer))
    UNION ALL
    SELECT 'comment', c.id, i.id, i.team_key || '-' || i.number, i.title,
           ts_headline('simple', c.body, tq, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=8'),
           (ts_rank_cd(c.tsv, tq) * 0.5)::double precision, i.status, i.team_id, i.project_id, i.assignee_id
    FROM comments c JOIN vis_issues i ON i.id = c.issue_id AND i.workspace_id = c.workspace_id
    WHERE 'comment' = ANY (p_kinds) AND c.tsv @@ tq
    UNION ALL
    SELECT 'project', p.id, NULL::uuid, NULL::text, p.name,
           ts_headline('simple', p.name || ' ' || p.description, tq, 'StartSel=<mark>,StopSel=</mark>,MaxFragments=1,MaxWords=20,MinWords=8'),
           ts_rank_cd(p.tsv, tq)::double precision, NULL::issue_status, NULL::uuid, p.id, NULL::uuid
    FROM projects p
    WHERE 'project' = ANY (p_kinds) AND NOT guest AND NOT issue_filter AND p.tsv @@ tq
      AND (p_project IS NULL OR p.id = p_project)
      AND (p_team IS NULL OR EXISTS (SELECT 1 FROM project_teams pt WHERE pt.project_id = p.id AND pt.team_id = p_team))
      AND (admin OR EXISTS (SELECT 1 FROM project_teams pt JOIN team_memberships tm ON tm.team_id = pt.team_id AND tm.workspace_id = pt.workspace_id
                            WHERE pt.project_id = p.id AND tm.user_id = p_user))
  )
  SELECT h.k, h.id, h.iid, h.ident, h.ttl, h.snip, h.rk, h.st, h.tid, h.pid, h.aid FROM hits h
  WHERE p_after_rank IS NULL OR h.rk < p_after_rank OR (h.rk = p_after_rank AND h.id > p_after_id)
  ORDER BY h.rk DESC, h.id ASC LIMIT lim;
END $$;
GRANT EXECUTE ON FUNCTION search_workspace(text, text[], integer, issue_status, uuid, uuid, uuid, uuid, double precision, uuid) TO app_user;
