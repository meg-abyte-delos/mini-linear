// Shared harness for the authorization matrix: users per role, real resources per cell, DB fingerprint.
import { randomUUID } from 'node:crypto';
import { inWs, loginAs, ownerPool, world, PW } from '../integration/helpers/world';
import { hashPassword } from '../../src/lib/auth/password';
import { ROLES, type RoleName } from './roles';
import { expected, letters, nextCycle, type Kind, type Row, type T } from './matrix';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
export type World = Awaited<ReturnType<typeof world>> & { O1: { id: string; email: string; cookie: string }; G2: { id: string; email: string; cookie: string }; roKey: string };
type Who = { cookie?: string; bearer?: string } | null;

export async function build(): Promise<World> {
  const W = await world();
  const s = randomUUID().slice(0, 6);
  const mk = async (tag: string, role: string) => {
    const u = { id: randomUUID(), email: `${tag}-${s}@example.test`, cookie: '' };
    await inWs(W.w1, async (c) => {
      await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [u.id, u.email, await hashPassword(PW)]);
      await c.query('insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,$4)', [randomUUID(), W.w1, u.id, role]);
    });
    u.cookie = await loginAs(u.email);
    return u;
  };
  const O1 = await mk('o1', 'owner'), G2 = await mk('g2', 'guest');
  const kr = await fetch(`${BASE}/api/v1/w/w1/api-keys`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, cookie: W.M1.cookie! }, body: JSON.stringify({ name: 'ro', scope: 'read' }) });
  if (kr.status !== 201) throw new Error('read key: ' + kr.status + ' ' + (await kr.text()));
  const roKey = (await kr.json()).token as string;
  // M1 is a member of T1 only through team_memberships (world); the read key acts as M1.
  return Object.assign(W, { O1, G2, roKey });
}

export const whoFor = (W: World, role: RoleName): Who => {
  switch (role) {
    case 'owner': return { cookie: W.O1.cookie };
    case 'admin': return { cookie: W.A1.cookie };
    case 'member': return { cookie: W.M1.cookie };
    case 'outsideTeam': return { cookie: W.M2.cookie };
    case 'guestShared': return { cookie: W.G1.cookie };
    case 'guestUnshared': return { cookie: W.G2.cookie };
    case 'otherWs': return { cookie: W.B1.cookie };
    case 'roKey': return { bearer: W.roKey };
    default: return null;
  }
};

export async function call(who: Who, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, stream = false) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: BASE, ...headers };
  if (who?.cookie) h.cookie = who.cookie;
  if (who?.bearer) { h.authorization = `Bearer ${who.bearer}`; delete h.origin; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  try {
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body), signal: ac.signal });
    let text = '';
    if (stream || (res.headers.get('content-type') ?? '').includes('event-stream')) await res.body?.cancel().catch(() => {}); else text = await res.text();
    return { status: res.status, text };
  } finally { clearTimeout(timer); }
}

const P = '/api/v1/w/w1';
const rnd = () => Math.random().toString(36).slice(2, 8);
const must = async (r: Promise<{ status: number; text: string }>, what: string, ok = [200, 201]) => {
  const x = await r; if (!ok.includes(x.status)) { let m = x.text.slice(0, 200); try { m = JSON.parse(x.text).error.message; } catch { /* keep raw */ } throw new Error(`fixture ${what}: ${x.status} ${m}`); }
  return x.text ? JSON.parse(x.text) : {};
};

/** Fresh resources for one cell. Everything is created through the API as a role that may create it. */
export class Fx {
  t: T;
  private made = new Map<Kind, Promise<void>>();
  private undo: (() => Promise<unknown>)[] = [];
  async cleanup() { for (const f of this.undo.reverse()) await f().catch(() => {}); this.undo = []; }
  constructor(private W: World) { this.t = { t1: W.t1, guestId: W.G1id, guestUnsharedId: W.G2.id, memberId: W.M1.id }; }
  async need(kinds: Kind[]) { for (const k of kinds) { if (!this.made.has(k)) this.made.set(k, this.create(k)); await this.made.get(k); } }
  private async create(k: Kind) {
    const { W, t } = this;
    const M = { cookie: W.M1.cookie }, A = { cookie: W.A1.cookie };
    const issue = async () => {
      const i = await must(call(M, 'POST', `${P}/issues`, { title: 'fx ' + rnd(), team_id: W.t1 }), 'issue');
      await must(call(A, 'POST', `${P}/issues/${i.id}/shares`, { guest_user_id: W.G1id }), 'share', [200, 201]);
      return i.id as string;
    };
    switch (k) {
      case 'issue': t.issue = await issue(); break;
      case 'trashed': {
        const i = await must(call(M, 'POST', `${P}/issues`, { title: 'trash ' + rnd(), team_id: W.t1 }), 'trashed');
        await must(call(A, 'POST', `${P}/issues/${i.id}/shares`, { guest_user_id: W.G1id }), 'share', [200, 201]);
        await must(call(M, 'DELETE', `${P}/issues/${i.id}`, undefined, { 'if-match': '1' }), 'trash', [200, 204]);
        t.trashed = i.id; break;
      }
      case 'ghconn': await must(call(A, 'PUT', `${P}/integrations/github`, {}), 'github connection', [200, 201]); break;
      case 'issue2': t.issue2 = (await must(call(M, 'POST', `${P}/issues`, { title: 'fx2 ' + rnd(), team_id: W.t1 }), 'issue2')).id; break;
      case 'comment': await this.need(['issue']); t.comment = (await must(call(M, 'POST', `${P}/issues/${t.issue}/comments`, { body: 'c ' + rnd() }), 'comment')).id; break;
      case 'relation': await this.need(['issue', 'issue2']); t.relation = (await must(call(M, 'POST', `${P}/issues/${t.issue}/relations`, { type: 'related', related_issue_id: t.issue2 }), 'relation')).id; break;
      case 'attachment': await this.need(['issue']); t.attachment = (await must(call(M, 'POST', `${P}/issues/${t.issue}/attachments`, { url: 'https://example.com/' + rnd() }), 'attachment')).id; break;
      case 'project': t.project = (await must(call(M, 'POST', `${P}/projects`, { name: 'fx ' + rnd(), team_ids: [W.t1] }), 'project')).id; break;
      case 'milestone': await this.need(['project']); t.milestone = (await must(call(M, 'POST', `${P}/projects/${t.project}/milestones`, { name: 'ms' }), 'milestone')).id; break;
      case 'update': await this.need(['project']); t.update = (await must(call(M, 'POST', `${P}/projects/${t.project}/updates`, { health: 'on_track', body: 'u' }), 'update')).id; break;
      case 'cycle': t.cycle = (await must(call(A, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'fx' + rnd(), ...nextCycle() }), 'cycle')).id; break;
      case 'label': t.label = (await must(call(A, 'POST', `${P}/labels`, { name: 'fx' + rnd(), color: '#aabbcc', team_id: null, group_id: null, description: '' }), 'label')).id; break;
      case 'group': t.group = (await must(call(A, 'POST', `${P}/label-groups`, { name: 'fx' + rnd(), color: '#aabbcc', team_id: null }), 'group')).id; break;
      case 'view': t.view = (await must(call(M, 'POST', `${P}/views`, { name: 'fx' + rnd(), shared: false, team_id: null, layout: 'list', filters: { op: 'and', rules: [] }, display: {} }), 'view')).id; break;
      case 'webhook': t.webhook = (await must(call(A, 'POST', `${P}/webhooks`, { url: 'https://example.com/h' + rnd(), events: ['issue.created'] }), 'webhook')).id; this.undo.push(() => call(A, 'DELETE', `${P}/webhooks/${t.webhook}`)); break;
      case 'delivery': {
        await this.need(['webhook']);
        t.delivery = await inWs(W.w1, async (c) => {
          const id = randomUUID();
          await c.query(`insert into webhook_deliveries (id, workspace_id, webhook_id, event, payload, status) values ($1,$2,$3,'issue.created','{}'::jsonb,'failed')`, [id, W.w1, t.webhook]);
          return id;
        }); break;
      }
      case 'apikey': t.apikey = (await must(call(M, 'POST', `${P}/api-keys`, { name: 'fx' + rnd(), scope: 'read' }), 'apikey')).id; this.undo.push(() => call(M, 'DELETE', `${P}/api-keys/${t.apikey}`)); break;
      case 'invite': t.invite = (await must(call(A, 'POST', `${P}/invites`, { email: `fx-${rnd()}@example.test`, role: 'member' }), 'invite')).id; break;
      case 'target': {
        t.target = await inWs(W.w1, async (c) => {
          const id = randomUUID();
          await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [id, `tg-${rnd()}@example.test`, await hashPassword(PW)]);
          await c.query(`insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,'member')`, [randomUUID(), W.w1, id]);
          return id;
        }); break;
      }
      case 'team': {
        t.team = (await must(call(A, 'POST', `${P}/teams`, { name: 'fx' + rnd(), key: letters() }), 'team')).id;
        await must(call(A, 'POST', `${P}/teams/${t.team}/members/${W.M1.id}`, {}), 'team member', [200, 201, 204]);
        break;
      }
      case 'state': await this.need(['team']); t.state = (await must(call(A, 'POST', `${P}/teams/${t.team}/states`, { name: 'fx' + rnd(), color: '#112233', category: 'started', position: 77 }), 'state')).id; break;
      case 'template': await this.need(['team']); t.template = (await must(call(A, 'POST', `${P}/teams/${t.team}/templates`, { name: 'fx' + rnd() }), 'template')).id; break;
      case 'notif': {
        const i = await must(call(A, 'POST', `${P}/issues`, { title: 'n ' + rnd(), team_id: W.t1, assignee_id: W.M1.id }), 'notif issue');
        const l = await must(call(M, 'GET', `${P}/notifications?limit=5`), 'notif list', [200]);
        const n = (l.items as { id: string; issue_id: string }[]).find((x) => x.issue_id === i.id) ?? l.items[0];
        if (!n) throw new Error('fixture notif: no notification for M1');
        t.notif = n.id; break;
      }
    }
  }
}

export const subst = (s: string, t: T) => s.replace(/\{([A-Za-z0-9]+)\}/g, (_, k) => {
  if (t[k] === undefined) throw new Error(`unknown token {${k}} in ${s}`);
  return t[k]!;
});
export const rowKinds = (r: Row): Kind[] => {
  const k = new Set<Kind>(r.needs ?? []);
  for (const m of (r.path + (r.query ?? '')).matchAll(/\{([A-Za-z0-9]+)\}/g)) {
    const n = m[1] as Kind; if (['issue','issue2','trashed','ghconn','comment','relation','attachment','project','milestone','update','cycle','label','group','view','trashed','ghconn','webhook','delivery','apikey','invite','target','team','state','template','notif'].includes(n)) k.add(n);
  }
  return [...k];
};

// ---- DB fingerprint: every table with a workspace_id column, minus ephemera (presence, rate limits, queue leases).
let fpSql: string | undefined;
// api_keys.last_used_at is touched by the key lookup itself, which runs before any refusal.
const IGNORE = new Set(['rate_limits', 'sessions', 'webhook_deliveries', 'api_keys']);
const ephemeral = (n: string) => /presence|rate_limit|lease/.test(n);
export async function fingerprint(ws: string): Promise<string> {
  if (!fpSql) {
    const r = await ownerPool.query(`select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id' order by 1`);
    const names = (r.rows as { table_name: string }[]).map((x) => x.table_name).filter((n) => !IGNORE.has(n) && !ephemeral(n));
    fpSql = `select string_agg(h, '') as fp from (` + names.map((n) => `select '${n}:' || md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h from "${n}" t`).join(' union all ') + `) x`;
  }
  return inWs(ws, async (c) => (await c.query(fpSql!)).rows[0].fp as string);
}

export type Cell = { row: Row; role: RoleName; want: ReturnType<typeof expected>; got: number; fpChanged: boolean };
export async function runCell(W: World, row: Row, role: RoleName): Promise<Cell> {
  const fx = new Fx(W);
  try {
    await fx.need(rowKinds(row));
    const path = P + subst(row.path, fx.t) + (row.query ? '?' + subst(row.query, fx.t) : '');
    const want = expected(row, role);
    const body = row.body ? row.body(fx.t) : (row.m === 'GET' || row.m === 'DELETE' ? undefined : {});
    const who = whoFor(W, role);
    if (row.prep === 'react') await call(who, 'POST', `${P}/comments/${fx.t.comment}/reactions`, { emoji: '\u{1F44D}' });
    const watch = want !== 'ok';
    const before = watch ? await fingerprint(W.w1) : '';
    const res = await call(who, row.m, path, body, row.headers, row.stream);
    const fpChanged = watch ? (await fingerprint(W.w1)) !== before : false;
    return { row, role, want, got: res.status, fpChanged };
  } finally { await fx.cleanup(); }
}
export const okStatus = (c: Cell) => c.want === 'ok' || c.want === 'noop' ? c.got === c.row.ok : c.got === c.want;
export { ROLES };
