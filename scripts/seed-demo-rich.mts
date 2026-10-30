// Idempotent RICH demo data for screenshots and local demos (slug `demo`). Runs AFTER seed-demo.mts, as OWNER, never at runtime and never in CI e2e
// (the e2e specs assert the 10-issue base seed). Adds 4 personas, 1 project, 5 labels, DEM-11..DEM-60, comments and an audit trail
// (create + state/assignee/priority/cycle changes) so the issue page activity feed and the burndown have history. Every row has a fixed id and is upserted.
import pg from 'pg';
import { hashPassword } from '../src/lib/auth/password';
import { id, USERS, PROJECTS, CYCLES, LABELS } from './demo-ids';
import { RICH_ISSUES, RICH_COMMENTS, RICH_USERS, RICH_LABELS, STATE_KEYS, atDay, type Who } from './demo-rich-data';

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error('DATABASE_OWNER_URL is required');
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo-rich refuses to run in production');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error(`seed-demo-rich refuses to run against ${host}: local or CI databases only`);
const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 8) throw new Error('SEED_DEMO_PASSWORD is required (8+ characters)');

const W = id(1), T = id(3), P3 = id(41);
const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query('begin');
  await c.query(`select set_config('app.workspace_id', $1, true)`, [W]);
  const base = await c.query('select 1 from workspaces where id = $1', [W]);
  if (!base.rows.length) throw new Error('run pnpm db:seed-demo first');
  const hash = await hashPassword(password);
  const uid: Record<Who, string> = { admin: '', mate: '', maya: '', jonas: '', priya: '', leo: '' };
  const people: [Who, string, string, string][] = [['admin', USERS.admin.id, USERS.admin.email, USERS.admin.name], ['mate', USERS.mate.id, USERS.mate.email, USERS.mate.name], ...RICH_USERS.map((u, i) => [u.key, id(81 + i), u.email, u.name] as [Who, string, string, string])];
  for (const [key, fixedId, email, name] of people) {
    const ex = await c.query('select id from users where lower(email) = $1', [email]);
    if (ex.rows[0]) uid[key] = ex.rows[0].id;
    else { uid[key] = fixedId; await c.query('insert into users (id, email, password_hash, display_name, email_verified_at) values ($1,$2,$3,$4,now())', [fixedId, email, hash, name]); }
  }
  for (const [i, u] of RICH_USERS.entries()) {
    await c.query(`insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,'member') on conflict (workspace_id, user_id) do nothing`, [id(400 + i), W, uid[u.key]]);
    await c.query(`insert into team_memberships (workspace_id, team_id, user_id, role) values ($1,$2,$3,'member') on conflict (team_id, user_id) do nothing`, [W, T, uid[u.key]]);
  }
  const st = await c.query('select id, legacy_status from workflow_states where team_id = $1', [T]);
  const stateId = (i: number) => { const r = st.rows.find((x) => x.legacy_status === STATE_KEYS[i]); if (!r) throw new Error(`missing state ${STATE_KEYS[i]}`); return r.id as string; };
  await c.query(`insert into projects (id, workspace_id, name, description, status, lead_id, start_date, target_date) values ($1,$2,'Design System','Shared components, tokens and motion for the app','in_progress',$3,'2026-10-01','2026-12-04') on conflict (id) do update set name = excluded.name, description = excluded.description, status = excluded.status, lead_id = excluded.lead_id, start_date = excluded.start_date, target_date = excluded.target_date`, [P3, W, uid.maya]);
  await c.query('insert into project_teams (workspace_id, project_id, team_id) values ($1,$2,$3) on conflict do nothing', [W, P3, T]);
  await c.query(`update projects set description = 'The issue tracker itself: lists, boards, issue page, inbox' where id = $1 and description = 'Demo project'`, [PROJECTS.p1]);
  const PJ = { p1: PROJECTS.p1, p2: PROJECTS.p2, p3: P3 } as const;
  const lab: Record<string, string> = { infra: LABELS.infra, bug: LABELS.bug, feature: LABELS.feature };
  for (const [i, [key, name, color]] of RICH_LABELS.entries()) {
    lab[key] = id(63 + i);
    await c.query('insert into labels (id, workspace_id, name, color) values ($1,$2,$3,$4) on conflict (id) do update set name = excluded.name, color = excluded.color', [lab[key], W, name, color]);
  }
  const CY = { c1: CYCLES.c1, c2: CYCLES.c2, c3: CYCLES.c3 } as const;
  let ev = 0;
  const audit = (n: number, actor: string, entity: string, entityId: string, action: string, at: string, diff: object) =>
    c.query('insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing', [id(50000 + n * 20 + ev++), W, actor, entity, entityId, action, JSON.stringify(diff), at]);
  for (const r of RICH_ISSUES) {
    const iid = id(100 + r.n), created = atDay(r.day, 0, (r.n * 7) % 50), creator = uid[r.by];
    const assignee = r.who ? uid[r.who] : null;
    await c.query(`insert into issues (id, workspace_id, team_id, number, title, description, state_id, priority, sort_key, created_by, assignee_id, project_id, cycle_id, estimate, due_date, created_at, updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) on conflict (id) do update set title = excluded.title, description = excluded.description, state_id = excluded.state_id, priority = excluded.priority,
      assignee_id = excluded.assignee_id, project_id = excluded.project_id, cycle_id = excluded.cycle_id, estimate = excluded.estimate, due_date = excluded.due_date, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      [iid, W, T, r.n, r.title, r.desc, stateId(r.state), r.prio, `a${String(r.n).padStart(2, '0')}`, creator, assignee, r.pj ? PJ[r.pj] : null, r.cy ? CY[r.cy] : null, r.est ?? null, r.due ?? null, created, atDay(r.day + r.age, 6)]);
    await c.query('delete from issue_labels where issue_id = $1 and label_id <> all($2::uuid[])', [iid, r.labels.map((l) => lab[l])]);
    for (const l of r.labels) await c.query('insert into issue_labels (workspace_id, issue_id, label_id) values ($1,$2,$3) on conflict do nothing', [W, iid, lab[l]]);
    // Audit trail: created as backlog, then one step per state up to the current one; assignee, cycle, project, labels and an urgent bump where they apply.
    ev = 0;
    await audit(r.n, creator, 'issue', iid, 'create', created, { title: { before: null, after: r.title }, status: { before: null, after: 'backlog' }, priority: { before: null, after: r.prio === 1 ? 2 : r.prio } });
    if (r.who) await audit(r.n, creator, 'issue', iid, 'update', atDay(r.day, 1), { assignee_id: { before: null, after: assignee } });
    if (r.cy) await audit(r.n, creator, 'issue', iid, 'update', atDay(r.day, 1, 5), { cycle_id: { before: null, after: CY[r.cy] } });
    if (r.pj) await audit(r.n, creator, 'issue', iid, 'update', atDay(r.day, 1, 10), { project_id: { before: null, after: PJ[r.pj] } });
    for (const l of r.labels) await audit(r.n, creator, 'issue', iid, 'update', atDay(r.day, 1, 20), { label_ids: { before: [], after: [lab[l]] } });
    if (r.prio === 1) await audit(r.n, creator, 'issue', iid, 'update', atDay(r.day, 2), { priority: { before: 2, after: 1 } });
    const path = r.state === 5 ? [1, 5] : Array.from({ length: r.state }, (_, k) => k + 1);
    let prev = 0;
    for (const [k, s] of path.entries()) {
      const when = atDay(r.day + Math.ceil(((k + 1) * r.age) / path.length), 3 + k);
      await audit(r.n, r.who ? uid[r.who] : creator, 'issue', iid, 'update', when, { status: { before: STATE_KEYS[prev], after: STATE_KEYS[s] }, state_id: { before: stateId(prev), after: stateId(s) } });
      prev = s;
    }
  }
  for (const [k, m] of RICH_COMMENTS.entries()) {
    const iid = id(100 + m.n), cid = id(2000 + k);
    const issue = RICH_ISSUES.find((x) => x.n === m.n)!;
    const at = atDay(issue.day + m.after, 4 + (k % 4));
    await c.query('insert into comments (id, workspace_id, issue_id, author_id, body, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6) on conflict (id) do update set body = excluded.body, author_id = excluded.author_id, created_at = excluded.created_at, updated_at = excluded.updated_at', [cid, W, iid, uid[m.by], m.body, at]);
    ev = 0;
    await audit(900 + k, uid[m.by], 'comment', cid, 'create', at, { body: { before: null, after: m.body }, issue_id: { before: null, after: iid } });
  }
  await c.query('update teams set issue_seq = greatest(issue_seq, $2) where id = $1', [T, RICH_ISSUES.reduce((a, r) => Math.max(a, r.n), 0)]);
  await c.query('commit');
  console.log(`seed-demo-rich ok: ${RICH_ISSUES.length} issues, ${RICH_COMMENTS.length} comments, ${RICH_USERS.length} extra users`);
} catch (e) { await c.query('rollback'); throw e; } finally { c.release(); await pool.end(); }
