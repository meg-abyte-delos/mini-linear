// Idempotent demo seed (slug `demo`). Same seed for local demo and CI e2e. Runs as OWNER (DATABASE_OWNER_URL), never at runtime.
// Every row has a fixed id and is upserted, so re-running is safe.
import pg from 'pg';
import { hashPassword } from '../src/lib/auth/password';
import { id, DEMO as D, USERS, PROJECTS, CYCLES, LABELS } from './demo-ids';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required');
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo refuses to run in production');
// It overwrites the demo users' password hashes: only ever against a local or CI database.
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`seed-demo refuses to run against ${host}: local or CI databases only`);
// The demo password is never in the repo: SEED_DEMO_PASSWORD (CI secret / local env) is required.
const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 8) throw new Error('SEED_DEMO_PASSWORD is required (8+ characters)');
const DEMO = { slug: D.slug, teamKey: D.teamKey };

const W = id(1), T = id(3);
const STATE_KEYS = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'canceled'];
// number, title, state index, priority (0 none, 1 urgent .. 4 low), assignee (admin|mate|null), project, cycle, labels
type Row = [number, string, number, number, 'admin' | 'mate' | null, 'p1' | 'p2' | null, 'c1' | 'c2' | 'c3' | null, (keyof typeof LABELS)[]];
const ISSUES: Row[] = [
  [1, 'Set up CI pipeline', 4, 2, 'admin', 'p1', 'c1', ['infra']], [2, 'Design the issue list', 3, 3, 'mate', 'p1', 'c2', ['feature']],
  [3, 'Board drag and drop', 2, 2, 'mate', 'p1', 'c2', ['feature']], [4, 'Keyboard shortcuts', 1, 1, 'admin', 'p1', 'c2', ['feature']],
  [5, 'Saved views', 0, 0, null, 'p1', null, []], [6, 'Cycle burndown', 1, 2, 'admin', 'p1', 'c3', []],
  [7, 'Cronkit parser port', 2, 1, 'mate', 'p2', 'c2', ['feature']], [8, 'Fix flaky nightly build', 1, 1, 'admin', 'p2', 'c2', ['bug', 'infra']],
  [9, 'Write the onboarding doc', 0, 4, null, null, null, []], [10, 'Roadmap polish', 1, 3, 'mate', 'p1', 'c3', []],
];
const USER_ROWS = [[USERS.admin, 'admin'], [USERS.mate, 'member'], [USERS.guest, 'guest'], [USERS.inbox, 'member']] as const;

const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query('begin');
  await c.query("select set_config('app.workspace_id', $1, true)", [W]);
  const hash = await hashPassword(password);
  // users/sessions are exempt from RLS. An existing user keeps its row; re-seeding resets the password to the env value.
  const uid: Record<string, string> = {};
  for (const [u] of USER_ROWS) {
    const ex = await c.query('select id from users where lower(email) = $1', [u.email]);
    uid[u.email] = ex.rows[0]?.id ?? u.id;
    if (ex.rows[0]) await c.query('update users set password_hash = $2, display_name = $3, email_verified_at = coalesce(email_verified_at, now()) where id = $1', [uid[u.email], hash, u.name]);
    else await c.query('insert into users (id, email, password_hash, display_name, email_verified_at) values ($1,$2,$3,$4,now())', [u.id, u.email, hash, u.name]);
  }
  const admin = uid[USERS.admin.email]!, mate = uid[USERS.mate.email]!, guest = uid[USERS.guest.email]!, inboxUser = uid[USERS.inbox.email]!;
  const who = { admin, mate };
  await c.query('insert into workspaces (id, slug, name) values ($1,$2,$3) on conflict (id) do update set name = excluded.name', [W, DEMO.slug, 'Demo']);
  for (const [i, [u, role]] of USER_ROWS.entries())
    await c.query('insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,$4::workspace_role) on conflict (workspace_id, user_id) do update set role = excluded.role', [id(i === 0 ? 6 : 70 + i), W, uid[u.email], role]);
  await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name', [T, W, 'Demo', DEMO.teamKey]);
  for (const [u, role] of USER_ROWS)
    await c.query('insert into team_memberships (workspace_id, team_id, user_id, role) values ($1,$2,$3,$4) on conflict (team_id, user_id) do update set role = excluded.role', [W, T, uid[u.email], role === 'admin' ? 'admin' : role]);
  // The teams_seed_states trigger (0101) creates the 6 default states on team insert (random ids): reuse them by legacy_status.
  const st = await c.query('select id, legacy_status from workflow_states where team_id = $1', [T]);
  const stateId = (i: number) => { const r = st.rows.find((x) => x.legacy_status === STATE_KEYS[i]); if (!r) throw new Error(`missing state ${STATE_KEYS[i]}`); return r.id as string; };
  // Projects: p1 in progress with a lead, p2 planned. Fixed dates (the roadmap spec asserts them).
  await c.query("insert into projects (id, workspace_id, name, description, status, lead_id, start_date, target_date) values ($1,$2,'Mini Linear','Demo project','in_progress',$3,'2026-09-14','2026-11-20') on conflict (id) do update set name = excluded.name, status = excluded.status, lead_id = excluded.lead_id, start_date = excluded.start_date, target_date = excluded.target_date", [PROJECTS.p1, W, admin]);
  await c.query("insert into projects (id, workspace_id, name, description, status, lead_id, start_date, target_date) values ($1,$2,'Cronkit','Cron parser','planned',$3,'2026-10-05','2026-12-18') on conflict (id) do update set name = excluded.name, status = excluded.status, lead_id = excluded.lead_id, start_date = excluded.start_date, target_date = excluded.target_date", [PROJECTS.p2, W, mate]);
  for (const p of Object.values(PROJECTS)) await c.query('insert into project_teams (workspace_id, project_id, team_id) values ($1,$2,$3) on conflict do nothing', [W, p, T]);
  // Cycles: fixed dates around the e2e test clock (2026-10-27): c1 past, c2 active, c3 upcoming. Written in an order that never overlaps.
  const CY: [string, string, string, string, number][] = [[CYCLES.c1, 'Cycle 1', '2026-09-30', '2026-10-13', 1], [CYCLES.c2, 'Cycle 2', '2026-10-14', '2026-10-27', 2], [CYCLES.c3, 'Cycle 3', '2026-10-28', '2026-11-10', 3]];
  await c.query('update cycles set start_date = $2, end_date = $3 where id = $1 and team_id = $4', [CYCLES.c1, '2026-01-01', '2026-01-02', T]); // park the old Cycle 1 out of the way
  for (const [cid, name, s, e, n] of CY)
    await c.query('insert into cycles (id, workspace_id, team_id, name, start_date, end_date, number) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set name = excluded.name, start_date = excluded.start_date, end_date = excluded.end_date, number = excluded.number', [cid, W, T, name, s, e, n]);
  for (const [lid, name, color] of [[LABELS.infra, 'Infra', '#5e6ad2'], [LABELS.bug, 'Bug', '#eb5757'], [LABELS.feature, 'Feature', '#26b5ce']] as const)
    await c.query('insert into labels (id, workspace_id, name, color) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, color = excluded.color', [lid, W, name, color]);
  for (const [n, title, s, prio, who_, pj, cy, labs] of ISSUES) {
    const iid = id(100 + n);
    await c.query(`insert into issues (id, workspace_id, team_id, number, title, state_id, priority, sort_key, created_by, assignee_id, project_id, cycle_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (id) do update set title = excluded.title, state_id = excluded.state_id, priority = excluded.priority, assignee_id = excluded.assignee_id, project_id = excluded.project_id, cycle_id = excluded.cycle_id`,
      [iid, W, T, n, title, stateId(s), prio, `a${String(n).padStart(2, '0')}`, admin, who_ ? who[who_] : null, pj ? PROJECTS[pj] : null, cy ? CYCLES[cy] : null]);
    for (const l of labs) await c.query('insert into issue_labels (workspace_id, issue_id, label_id) values ($1,$2,$3) on conflict do nothing', [W, iid, LABELS[l]]);
  }
  await c.query('update teams set issue_seq = greatest(issue_seq, $2) where id = $1', [T, ISSUES.length]);
  // The guest sees exactly the issues with an active share.
  for (const n of [1, 4])
    await c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4) on conflict (issue_id, guest_user_id) do update set revoked_at = null', [W, id(100 + n), guest, admin]);
  // Inbox of the inbox persona: 3 notifications, 2 unread (notifications are recipient-only under RLS).
  await c.query("select set_config('app.user_id', $1, true)", [admin]);
  await c.query('delete from notifications where id = any($1::uuid[])', [[id(301), id(302), id(303)]]); // earlier seed versions put them on the admin
  await c.query("select set_config('app.user_id', $1, true)", [inboxUser]);
  // [notification id offset, issue number, type, read]: the inbox lists newest first (id desc), so DEM-1 is on top. DEM-1 and DEM-2 are unread, DEM-3 is read.
  const NOTIF: [number, number, string, boolean][] = [[12, 1, 'assigned', false], [11, 2, 'status_change', false], [10, 3, 'comment', true]];
  for (const [k, n, type, read] of NOTIF)
    await c.query("insert into notifications (id, workspace_id, user_id, actor_id, type, issue_id, read_at, archived_at, snoozed_until) values ($1,$2,$3,$4,$5::notification_type,$6,$7,null,null) on conflict (id) do update set type = excluded.type, issue_id = excluded.issue_id, actor_id = excluded.actor_id, read_at = excluded.read_at, archived_at = null, snoozed_until = null", [id(300 + k), W, inboxUser, mate, type, id(100 + n), read ? new Date().toISOString() : null]);
  await c.query('commit');
  console.log(`seed-demo ok: workspace ${DEMO.slug}, logins ${USER_ROWS.map(([u]) => u.email).join(', ')}`);
} catch (e) { await c.query('rollback'); throw e; } finally { c.release(); await pool.end(); }
