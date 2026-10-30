// Seed v2. Idempotent RICH demo data for screenshots and local demos (slug `demo`). Runs AFTER seed-demo.mts, as OWNER, never at runtime and never in CI e2e
// (the e2e specs assert the 10-issue base seed). Adds 4 personas (and gives every persona a full name), 3 teams, 3 projects, 11 grouped labels, ~85 issues, threaded comments with @mentions, the demo admin's inbox and an audit trail
// (create + state/assignee/priority/cycle changes) so the issue page activity feed and the burndown have history. Every row has a fixed id and is upserted.
import pg from 'pg';
import { hashPassword } from '../src/lib/auth/password';
import { id, USERS, PROJECTS, CYCLES, LABELS } from './demo-ids';
import { RICH_ISSUES, RICH_COMMENTS, RICH_USERS, RICH_NOTIFS, ALL_LABELS, LABEL_GROUPS, PERSONA_NAMES, STATE_KEYS, atDay, commentAt, issueByKey, mentionsOf, type Who, type TeamKey } from './demo-rich-data';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required');
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo-rich refuses to run in production');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`seed-demo-rich refuses to run against ${host}: local or CI databases only`);
const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 8) throw new Error('SEED_DEMO_PASSWORD is required (8+ characters)');

const W = id(1), T = id(3), P3 = id(41);
const TEAMS: Record<TeamKey, { id: string; name: string }> = { DEM: { id: T, name: 'Demo' }, PLT: { id: id(90), name: 'Platform' }, DSN: { id: id(91), name: 'Design' } };
const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query('begin');
  await c.query(`select set_config('app.workspace_id', $1, true)`, [W]);
  const base = await c.query('select 1 from workspaces where id = $1', [W]);
  if (!base.rows.length) throw new Error('run pnpm db:seed-demo first');
  const hash = await hashPassword(password);
  const uid: Record<Who, string> = { admin: '', mate: '', maya: '', jonas: '', priya: '', leo: '' };
  const people: [Who, string, string, string][] = [['admin', USERS.admin.id, USERS.admin.email, PERSONA_NAMES[USERS.admin.email]!], ['mate', USERS.mate.id, USERS.mate.email, PERSONA_NAMES[USERS.mate.email]!], ...RICH_USERS.map((u, i) => [u.key, id(81 + i), u.email, u.name] as [Who, string, string, string])];
  for (const [key, fixedId, email, name] of people) {
    const ex = await c.query('select id from users where lower(email) = $1', [email]);
    if (ex.rows[0]) { uid[key] = ex.rows[0].id; if (PERSONA_NAMES[email]) await c.query('update users set display_name = $2 where id = $1 and display_name is distinct from $2', [uid[key], PERSONA_NAMES[email]]); }
    else { uid[key] = fixedId; await c.query('insert into users (id, email, password_hash, display_name, email_verified_at) values ($1,$2,$3,$4,now())', [fixedId, email, hash, name]); }
  }
  for (const email of ['guest@example.test', 'inbox@example.test']) // base-seed personas that exist: give them full names too
    await c.query('update users set display_name = $2 where lower(email) = $1 and display_name is distinct from $2', [email, PERSONA_NAMES[email]]);
  for (const [i, u] of RICH_USERS.entries())
    await c.query(`insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,'member') on conflict (workspace_id, user_id) do nothing`, [id(400 + i), W, uid[u.key]]);
  // Extra teams (the teams_seed_states trigger creates their 6 workflow states). Every non-guest persona joins every team.
  for (const [key, t] of Object.entries(TEAMS))
    if (key !== 'DEM') await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name', [t.id, W, t.name, key]);
  const roleOf = (who: Who) => (who === 'admin' ? 'admin' : 'member');
  for (const [key, t] of Object.entries(TEAMS))
    for (const who of Object.keys(uid) as Who[]) {
      if (key === 'DEM' && who !== 'maya' && who !== 'jonas' && who !== 'priya' && who !== 'leo') continue; // admin and mate are already in the base team
      await c.query(`insert into team_memberships (workspace_id, team_id, user_id, role) values ($1,$2,$3,$4) on conflict (team_id, user_id) do nothing`, [W, t.id, uid[who], roleOf(who)]);
    }
  await c.query(`update issues set title = 'Port the cron parser from the prototype' where id = $1 and title = 'Cronkit parser port'`, [id(107)]); // titles never repeat a project name
  const st = await c.query('select id, team_id, legacy_status from workflow_states where team_id = any($1::uuid[])', [Object.values(TEAMS).map((t) => t.id)]);
  const stateId = (team: TeamKey, i: number) => { const r = st.rows.find((x) => x.team_id === TEAMS[team].id && x.legacy_status === STATE_KEYS[i]); if (!r) throw new Error(`missing state ${STATE_KEYS[i]} for ${team}`); return r.id as string; };
  await c.query(`insert into projects (id, workspace_id, name, description, status, lead_id, start_date, target_date) values ($1,$2,'Design System','Shared components, tokens and motion for the app','in_progress',$3,'2026-10-01','2026-12-04') on conflict (id) do update set name = excluded.name, description = excluded.description, status = excluded.status, lead_id = excluded.lead_id, start_date = excluded.start_date, target_date = excluded.target_date`, [P3, W, uid.maya]);
  for (const t of Object.values(TEAMS)) for (const p of [P3, PROJECTS.p1, PROJECTS.p2]) await c.query('insert into project_teams (workspace_id, project_id, team_id) values ($1,$2,$3) on conflict do nothing', [W, p, t.id]);
  await c.query(`update projects set description = 'The issue tracker itself: lists, boards, issue page, inbox' where id = $1 and description = 'Demo project'`, [PROJECTS.p1]);
  const PJ = { p1: PROJECTS.p1, p2: PROJECTS.p2, p3: P3 } as const;
  // Project priority and health posts (the health on the list is the latest update). Fixed ids, upserted; older posts give a trend.
  const PJ_PRIO: [string, number][] = [[PJ.p1, 1], [PJ.p2, 3], [PJ.p3, 2]];
  for (const [pid, prio] of PJ_PRIO) await c.query('update projects set priority = $2 where id = $1 and priority <> $2', [pid, prio]);
  const UPDATES: [number, string, Who, string, string, number][] = [
    [6000, PJ.p1, 'mate', 'on_track', 'Issue page and inbox shipped. Board polish is the last stretch.', 20],
    [6001, PJ.p1, 'priya', 'on_track', 'Cycle 3 is on plan: members page and invites are in review.', 6],
    [6002, PJ.p2, 'mate', 'on_track', 'Parser covers ranges, steps and lists.', 18],
    [6003, PJ.p2, 'jonas', 'at_risk', 'Next-run preview slipped: time zone handling needs a second pass.', 5],
    [6004, PJ.p3, 'maya', 'at_risk', 'Dark tokens done, light theme contrast still open.', 14],
    [6005, PJ.p3, 'maya', 'off_track', 'Motion and empty-state work blocked on the icon set; target date will move.', 3],
  ];
  for (const [k, pid, by, health, body, daysAgo] of UPDATES) {
    const at = new Date(Date.now() - daysAgo * 86400000).toISOString();
    await c.query('insert into project_updates (id, workspace_id, project_id, author_id, health, body, created_at, updated_at) values ($1,$2,$3,$4,$5::project_health,$6,$7,$7) on conflict (id) do update set health = excluded.health, body = excluded.body, author_id = excluded.author_id, created_at = excluded.created_at, updated_at = excluded.updated_at', [id(k), W, pid, uid[by], health, body, at]);
  }
  const LABEL_IDS: Record<string, number> = { improvement: 63, design: 64, performance: 65, docs: 66, security: 67, a11y: 68, techdebt: 69, triage: 70 };
  const grp: Record<string, string> = {};
  for (const [i, [key, name, color]] of LABEL_GROUPS.entries()) {
    grp[key] = id(95 + i);
    await c.query('insert into label_groups (id, workspace_id, name, color) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, color = excluded.color', [grp[key], W, name, color]);
  }
  const lab: Record<string, string> = { infra: LABELS.infra, bug: LABELS.bug, feature: LABELS.feature };
  for (const [key, name, color, group] of ALL_LABELS) {
    if (!lab[key]) lab[key] = id(LABEL_IDS[key]!);
    await c.query('insert into labels (id, workspace_id, name, color, group_id) values ($1,$2,$3,$4,$5) on conflict (id) do update set name = excluded.name, color = excluded.color, group_id = excluded.group_id', [lab[key], W, name, color, group ? grp[group] : null]);
  }
  const CY = { c1: CYCLES.c1, c2: CYCLES.c2, c3: CYCLES.c3 } as const;
  let ev = 0;
  const audit = (n: number, actor: string, entity: string, entityId: string, action: string, at: string, diff: object) =>
    c.query('insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing', [id(50000 + n * 20 + ev++), W, actor, entity, entityId, action, JSON.stringify(diff), at]);
  // Ids: DEM-n keeps id(100+n) (base seed + earlier rich seed); other teams use id(3000 + key). `key` also numbers the audit events.
  const issueId = (r: { team: TeamKey; key: number; n: number }) => (r.team === 'DEM' ? id(100 + r.n) : id(3000 + r.key));
  for (const r of RICH_ISSUES) {
    const iid = issueId(r), created = atDay(r.day, 0, (r.n * 7) % 50), creator = uid[r.by], team = TEAMS[r.team].id;
    const assignee = r.who ? uid[r.who] : null;
    await c.query(`insert into issues (id, workspace_id, team_id, number, title, description, state_id, priority, sort_key, created_by, assignee_id, project_id, cycle_id, estimate, due_date, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict (id) do update set title = excluded.title, description = excluded.description, state_id = excluded.state_id, priority = excluded.priority,
      assignee_id = excluded.assignee_id, project_id = excluded.project_id, cycle_id = excluded.cycle_id, estimate = excluded.estimate, due_date = excluded.due_date, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [iid, W, team, r.n, r.title, r.desc, stateId(r.team, r.state), r.prio, `a${String(r.key).padStart(3, '0')}`, creator, assignee, r.pj ? PJ[r.pj] : null, r.cy ? CY[r.cy] : null, r.est ?? null, r.due ?? null, created, atDay(r.day + r.age, 6)]);
    await c.query('delete from issue_labels where issue_id = $1 and label_id <> all($2::uuid[])', [iid, r.labels.map((l) => lab[l])]);
    for (const l of r.labels) await c.query('insert into issue_labels (workspace_id, issue_id, label_id) values ($1,$2,$3) on conflict do nothing', [W, iid, lab[l]]);
    // Audit trail: created as backlog, then one step per state up to the current one; assignee, cycle, project, labels and an urgent bump where they apply.
    ev = 0;
    await audit(r.key, creator, 'issue', iid, 'create', created, { title: { before: null, after: r.title }, status: { before: null, after: 'backlog' }, priority: { before: null, after: r.prio === 1 ? 2 : r.prio } });
    if (r.who) await audit(r.key, creator, 'issue', iid, 'update', atDay(r.day, 1), { assignee_id: { before: null, after: assignee } });
    if (r.cy) await audit(r.key, creator, 'issue', iid, 'update', atDay(r.day, 1, 5), { cycle_id: { before: null, after: CY[r.cy] } });
    if (r.pj) await audit(r.key, creator, 'issue', iid, 'update', atDay(r.day, 1, 10), { project_id: { before: null, after: PJ[r.pj] } });
    for (const l of r.labels) await audit(r.key, creator, 'issue', iid, 'update', atDay(r.day, 1, 20), { label_ids: { before: [], after: [lab[l]] } });
    if (r.prio === 1) await audit(r.key, creator, 'issue', iid, 'update', atDay(r.day, 2), { priority: { before: 2, after: 1 } });
    const path = r.state === 5 ? [1, 5] : Array.from({ length: r.state }, (_, k) => k + 1);
    let prev = 0;
    for (const [k, s] of path.entries()) {
      const when = atDay(r.day + Math.ceil(((k + 1) * r.age) / path.length), 3 + k);
      await audit(r.key, r.who ? uid[r.who] : creator, 'issue', iid, 'update', when, { status: { before: STATE_KEYS[prev], after: STATE_KEYS[s] }, state_id: { before: stateId(r.team, prev), after: stateId(r.team, s) } });
      prev = s;
    }
  }
  for (const t of Object.values(TEAMS)) await c.query('update teams set issue_seq = greatest(issue_seq, $2) where id = $1', [t.id, RICH_ISSUES.filter((x) => TEAMS[x.team].id === t.id).reduce((a, r) => Math.max(a, r.n), 0)]);
  // Comments: roots first, then replies (parent FK). {who} tokens become @[Name](uuid) mentions, recorded in comment_mentions like the app does.
  const nameOf: Record<Who, string> = { admin: PERSONA_NAMES[USERS.admin.email]!, mate: PERSONA_NAMES[USERS.mate.email]!, ...Object.fromEntries(RICH_USERS.map((u) => [u.key, u.name])) } as Record<Who, string>;
  const render = (body: string) => body.replace(/\{(admin|mate|maya|jonas|priya|leo)\}/g, (_m, w: Who) => `@[${nameOf[w]}](${uid[w]})`);
  const cid = (k: number) => id(2000 + k);
  for (const m of [...RICH_COMMENTS].sort((a, b) => Number(a.re !== undefined) - Number(b.re !== undefined))) {
    const issue = issueByKey('DEM', m.n), iid = issueId(issue), at = commentAt(m), body = render(m.body);
    const resolvedAt = m.resolved ? new Date(Date.parse(at) + 3600_000).toISOString() : null;
    await c.query(`insert into comments (id, workspace_id, issue_id, author_id, body, created_at, updated_at, parent_comment_id, resolved_at, resolved_by) values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)
      on conflict (id) do update set body = excluded.body, author_id = excluded.author_id, issue_id = excluded.issue_id, created_at = excluded.created_at, updated_at = excluded.updated_at, parent_comment_id = excluded.parent_comment_id, resolved_at = excluded.resolved_at, resolved_by = excluded.resolved_by`,
      [cid(m.k), W, iid, uid[m.by], body, at, m.re === undefined ? null : cid(m.re), resolvedAt, m.resolved ? uid.admin : null]);
    await c.query('delete from comment_mentions where comment_id = $1', [cid(m.k)]);
    for (const w of new Set(mentionsOf(m.body))) await c.query('insert into comment_mentions (workspace_id, comment_id, user_id, created_at) values ($1,$2,$3,$4) on conflict do nothing', [W, cid(m.k), uid[w], at]);
    ev = 0;
    await audit(900 + m.k, uid[m.by], 'comment', cid(m.k), 'create', at, { body: { before: null, after: body }, issue_id: { before: null, after: iid } });
  }
  // Inbox of the demo admin (notifications are recipient-only under RLS). Newest = highest id, so ids follow created_at.
  await c.query("select set_config('app.user_id', $1, true)", [uid.admin]);
  await c.query('delete from notifications where user_id = $1 and id >= $2 and id < $3 and id <> all($4::uuid[])', [uid.admin, id(5000), id(5100), RICH_NOTIFS.map((_n, k) => id(5000 + k))]);
  for (const [k, nt] of RICH_NOTIFS.entries()) {
    const read = nt.read ? new Date(Date.parse(nt.at) + 1800_000).toISOString() : null;
    await c.query(`insert into notifications (id, workspace_id, user_id, actor_id, type, issue_id, comment_id, read_at, archived_at, snoozed_until, created_at) values ($1,$2,$3,$4,$5::notification_type,$6,$7,$8,$9,null,$10)
      on conflict (id) do update set actor_id = excluded.actor_id, type = excluded.type, issue_id = excluded.issue_id, comment_id = excluded.comment_id, read_at = excluded.read_at, archived_at = excluded.archived_at, created_at = excluded.created_at`,
      [id(5000 + k), W, uid.admin, nt.actor ? uid[nt.actor] : null, nt.type, issueId(issueByKey('DEM', nt.n)), nt.comment === undefined ? null : cid(nt.comment), read, nt.archived ? read : null, nt.at]);
  }
  await c.query('commit');
  console.log(`seed-demo-rich ok: ${RICH_ISSUES.length} issues, ${RICH_COMMENTS.length} comments, ${RICH_NOTIFS.length} notifications, ${ALL_LABELS.length} labels, ${RICH_USERS.length} extra users`);
} catch (e) { await c.query('rollback'); throw e; } finally { c.release(); await pool.end(); }
