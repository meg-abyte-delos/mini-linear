// Idempotent demo seed (slug `demo`). Same seed for local demo and CI e2e. Runs as OWNER (DATABASE_OWNER_URL), never at runtime.
// Every row has a fixed id and is upserted, so re-running is safe.
import pg from 'pg';
import { hashPassword } from '../src/lib/auth/password';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required');
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo refuses to run in production (fixed demo password)');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DEMO = { slug: 'demo', email: 'demo@example.test', password: 'demo-password-123', teamKey: 'DEM' };

const W = id(1), U = id(2), T = id(3), P = id(4), C = id(5);
const STATES: [number, string, string, string, number, string][] = [
  [10, 'Backlog', '#bec2c8', 'backlog', 1, 'backlog'], [11, 'Todo', '#e2e2e2', 'unstarted', 2, 'todo'],
  [12, 'In Progress', '#f2c94c', 'started', 3, 'in_progress'], [13, 'In Review', '#5e6ad2', 'started', 4, 'in_review'],
  [14, 'Done', '#5e6ad2', 'completed', 5, 'done'], [15, 'Canceled', '#95a2b3', 'canceled', 6, 'canceled'],
];
const ISSUES: [number, string, number, number][] = [ // number, title, state index (0..5), priority
  [1, 'Set up CI pipeline', 4, 2], [2, 'Design the issue list', 3, 3], [3, 'Board drag and drop', 2, 2],
  [4, 'Keyboard shortcuts', 1, 1], [5, 'Saved views', 0, 0], [6, 'Cycle burndown', 1, 2],
];

const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query('begin');
  await c.query("select set_config('app.workspace_id', $1, true)", [W]);
  const hash = await hashPassword(DEMO.password);
  // users/sessions are exempt from RLS. Existing demo user keeps its row (id is the conflict target via email lookup).
  const ex = await c.query('select id from users where lower(email) = $1', [DEMO.email]);
  const uid: string = ex.rows[0]?.id ?? U;
  if (!ex.rows[0]) await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [U, DEMO.email, hash]);
  await c.query('insert into workspaces (id, slug, name) values ($1,$2,$3) on conflict (id) do update set name = excluded.name', [W, DEMO.slug, 'Demo']);
  await c.query("insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,'admin') on conflict (workspace_id, user_id) do nothing", [id(6), W, uid]);
  await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name', [T, W, 'Demo', DEMO.teamKey]);
  await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3) on conflict do nothing', [W, T, uid]);
  // The teams_seed_states trigger (0101) creates the 6 default states on team insert (random ids): reuse them by legacy_status.
  const st = await c.query('select id, legacy_status from workflow_states where team_id = $1', [T]);
  const stateId = (i: number) => { const r = st.rows.find((x) => x.legacy_status === STATES[i]![5]); if (!r) throw new Error(`missing state ${STATES[i]![1]}`); return r.id as string; };
  await c.query('insert into projects (id, workspace_id, name, description) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name', [P, W, 'Launch', 'Demo project']);
  await c.query('insert into project_teams (workspace_id, project_id, team_id) values ($1,$2,$3) on conflict do nothing', [W, P, T]);
  await c.query("insert into cycles (id, workspace_id, team_id, name, start_date, end_date) values ($1,$2,$3,'Cycle 1', current_date - 3, current_date + 10) on conflict (id) do nothing", [C, W, T]);
  for (const [n, title, st, prio] of ISSUES)
    await c.query(`insert into issues (id, workspace_id, team_id, number, title, state_id, priority, sort_key, created_by, assignee_id, project_id, cycle_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11) on conflict (id) do update set title = excluded.title`,
      [id(100 + n), W, T, n, title, stateId(st), prio, `a${n}`, uid, P, C]);
  await c.query('update teams set issue_seq = greatest(issue_seq, $2) where id = $1', [T, ISSUES.length]);
  await c.query('commit');
  console.log(`seed-demo ok: workspace ${DEMO.slug}, login ${DEMO.email}`);
} catch (e) { await c.query('rollback'); throw e; } finally { c.release(); await pool.end(); }
