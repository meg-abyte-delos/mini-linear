-- Realistic perf/demo seed (Area 10). DEV/PERF ONLY, never run against prod.
-- Runs as the OWNER role (not superuser): FORCE RLS applies, so the tenant is pinned with app.workspace_id first.
--   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -v slug=perf -v issues=5000 -f db/seed/perf-seed.sql
-- Produces: 1 workspace, 40 users (owner/admin/members/guests), 4 teams, 12 projects, 6 cycles per team, 20 labels,
-- :issues issues (default 5000) with 0-3 labels, ~10% sub-issues, ~3 comments per issue, a few guest shares.
-- Seeded users get an unusable password hash: they exist for data shape, not for login.
\if :{?slug} \else \set slug perf \endif
\if :{?issues} \else \set issues 5000 \endif
BEGIN;
SELECT gen_random_uuid() AS ws \gset
SELECT set_config('app.workspace_id', :'ws', true);
SELECT setseed(0.42);
INSERT INTO workspaces (id, slug, name) VALUES (:'ws', :'slug', initcap(:'slug') || ' Inc');

CREATE TEMP TABLE s_users AS
  SELECT gen_random_uuid() AS id, g AS n,
         CASE WHEN g = 1 THEN 'owner' WHEN g <= 3 THEN 'admin' WHEN g <= 37 THEN 'member' ELSE 'guest' END::workspace_role AS role
  FROM generate_series(1, 40) g;
INSERT INTO users (id, email, password_hash, email_verified_at)
  SELECT id, format('user%s@%s.seed.test', n, :'slug'), '!seed-no-login', now() FROM s_users;
INSERT INTO memberships (id, workspace_id, user_id, role) SELECT gen_random_uuid(), :'ws', id, role FROM s_users;

CREATE TEMP TABLE s_teams AS
  SELECT gen_random_uuid() AS id, k, nm, ord FROM (VALUES ('ENG','Engineering',1),('DES','Design',2),('OPS','Operations',3),('MOB','Mobile',4)) v(k, nm, ord);
INSERT INTO teams (id, workspace_id, name, key) SELECT id, :'ws', nm, k FROM s_teams;
-- members spread across teams (each member in 1-2 teams), guests in none
INSERT INTO team_memberships (workspace_id, team_id, user_id)
  SELECT DISTINCT :'ws'::uuid, t.id, u.id FROM s_users u JOIN s_teams t ON t.ord = 1 + (u.n % 4) OR (u.n % 3 = 0 AND t.ord = 1 + ((u.n + 1) % 4))
  WHERE u.role <> 'guest';

CREATE TEMP TABLE s_projects AS SELECT gen_random_uuid() AS id, g AS n FROM generate_series(1, 12) g;
INSERT INTO projects (id, workspace_id, name, description)
  SELECT id, :'ws', (ARRAY['Onboarding revamp','Billing v2','Mobile offline','Search','Realtime sync','Design system','SSO','Audit log','Perf Q4','API v2','Inbox','Roadmap views'])[n], 'Seeded project ' || n FROM s_projects;
INSERT INTO project_teams (workspace_id, project_id, team_id)
  SELECT :'ws', p.id, t.id FROM s_projects p JOIN s_teams t ON t.ord = 1 + (p.n % 4) OR (p.n % 5 = 0 AND t.ord = 1);

CREATE TEMP TABLE s_cycles AS
  SELECT gen_random_uuid() AS id, t.id AS team_id, c, (date '2026-08-03' + (c - 1) * 14) AS sd FROM s_teams t, generate_series(1, 6) c;
INSERT INTO cycles (id, workspace_id, team_id, name, start_date, end_date)
  SELECT id, :'ws', team_id, 'Cycle ' || c, sd, sd + 13 FROM s_cycles;

CREATE TEMP TABLE s_labels AS SELECT gen_random_uuid() AS id, g AS n FROM generate_series(1, 20) g;
INSERT INTO labels (id, workspace_id, name, color)
  SELECT id, :'ws', (ARRAY['bug','feature','improvement','tech-debt','security','perf','a11y','ux','backend','frontend','mobile','infra','docs','customer','p0-incident','regression','design','research','flaky','good-first-issue'])[n],
         '#' || lpad(to_hex((n * 2654435761) % 16777216), 6, '0') FROM s_labels;

-- Issues: number per team, statuses skewed like a real tracker, ~60% assigned, ~50% in a project, ~40% in a cycle.
CREATE TEMP TABLE s_issues AS
  SELECT gen_random_uuid() AS id, g, t.id AS team_id, t.ord,
         row_number() OVER (PARTITION BY t.id ORDER BY g) AS num, random() AS r1, random() AS r2, random() AS r3, random() AS r4
  FROM generate_series(1, :issues) g JOIN s_teams t ON t.ord = 1 + (g % 4);
ALTER TABLE s_issues ADD PRIMARY KEY (id);
CREATE INDEX ON s_issues (team_id, num);
ANALYZE s_users; ANALYZE s_teams; ANALYZE s_cycles; ANALYZE s_labels; ANALYZE s_issues;
INSERT INTO issues (id, workspace_id, team_id, number, title, description, status, priority, assignee_id, project_id, cycle_id,
                    sort_key, created_by, created_at, updated_at)
  SELECT i.id, :'ws', i.team_id, i.num,
    (ARRAY['Fix','Add','Refactor','Investigate','Polish','Remove','Migrate','Document'])[1 + (i.g % 8)] || ' ' ||
    (ARRAY['login redirect','board drag and drop','label picker','cycle burndown','webhook retries','dark mode contrast','CSV export','SSO callback','inbox badge','search ranking','comment editor','keyboard shortcuts'])[1 + (i.g % 12)] || ' #' || i.g,
    repeat('Steps to reproduce, expected vs actual, context. ', 1 + (i.g % 6)),
    (CASE WHEN i.r1 < .20 THEN 'backlog' WHEN i.r1 < .45 THEN 'todo' WHEN i.r1 < .60 THEN 'in_progress' WHEN i.r1 < .68 THEN 'in_review' WHEN i.r1 < .95 THEN 'done' ELSE 'canceled' END)::issue_status,
    (i.g % 5)::smallint,
    CASE WHEN i.r2 < .6 THEN (SELECT tm.user_id FROM team_memberships tm WHERE tm.team_id = i.team_id ORDER BY tm.user_id OFFSET (i.g % 5) LIMIT 1) END,
    CASE WHEN i.r3 < .5 THEN (SELECT pt.project_id FROM project_teams pt WHERE pt.team_id = i.team_id ORDER BY pt.project_id OFFSET (i.g % 3) LIMIT 1) END,
    CASE WHEN i.r4 < .4 THEN (SELECT c.id FROM s_cycles c WHERE c.team_id = i.team_id AND c.c = 1 + (i.g % 6)) END,
    lpad(to_hex(i.g * 4096), 10, '0'),
    (SELECT id FROM s_users WHERE n = 1 + (i.g % 37)),
    now() - make_interval(mins => (:issues - i.g) * 7), now() - make_interval(mins => (:issues - i.g) * 3)
  FROM s_issues i;
UPDATE teams t SET issue_seq = (SELECT count(*) FROM s_issues s WHERE s.team_id = t.id) WHERE t.workspace_id = :'ws';
-- ~10% sub-issues: parent is an earlier issue of the same team (depth 1, so the depth/cycle trigger stays happy)
CREATE TEMP TABLE s_parent AS SELECT sc.id AS child, sp.id AS parent FROM s_issues sc JOIN s_issues sp ON sp.team_id = sc.team_id AND sp.num = sc.num - 1
  WHERE sc.num % 10 = 0;
UPDATE issues c SET parent_id = s.parent FROM s_parent s WHERE c.id = s.child;
ANALYZE issues;

INSERT INTO issue_labels (workspace_id, issue_id, label_id)
  SELECT DISTINCT :'ws'::uuid, i.id, l.id FROM s_issues i JOIN s_labels l ON l.n IN (1 + (i.g % 20), 1 + ((i.g * 7) % 20), 1 + ((i.g * 13) % 20))
  WHERE (l.n = 1 + (i.g % 20) AND i.g % 4 <> 0) OR (l.n = 1 + ((i.g * 7) % 20) AND i.g % 3 = 0) OR (l.n = 1 + ((i.g * 13) % 20) AND i.g % 5 = 0);

INSERT INTO comments (id, workspace_id, issue_id, author_id, body, created_at)
  SELECT gen_random_uuid(), :'ws', i.id, (SELECT id FROM s_users WHERE n = 1 + ((i.g + k) % 37)),
         'Seeded comment ' || k || ' on issue ' || i.g || '. Looks good, one nit on the edge case.', now() - make_interval(mins => k * 11)
  FROM s_issues i, generate_series(1, 1 + (i.g % 5)) k;

INSERT INTO issue_shares (workspace_id, issue_id, guest_user_id, shared_by)
  SELECT :'ws', i.id, u.id, (SELECT id FROM s_users WHERE n = 1) FROM s_issues i JOIN s_users u ON u.role = 'guest' AND i.g % 97 = u.n % 3;
COMMIT;
SELECT :'ws' AS workspace_id, :'slug' AS slug;
