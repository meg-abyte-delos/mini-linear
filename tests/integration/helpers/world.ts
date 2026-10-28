// Fixture world for the black-box auth/tenancy suites. Seeds as OWNER (FORCE RLS applies, so the tenant is set per tx).
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../../../src/lib/auth/password';

export const ownerPool = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
export const appPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

/** User handle: a real session cookie obtained via /api/v1/auth/login (pnpm start has no dev-auth header). */
export type U = { id: string; email: string; cookie?: string };
export const PW = 'world-fixture-password-123';
let pwHash: Promise<string> | undefined;
export async function loginAs(email: string, password = PW, baseUrl = BASE): Promise<string> {
  const r = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
/** Rename a stale fixture workspace out of the way. workspaces has FORCE RLS keyed on id, so only a superuser sees an old row. */
async function freeSlug(slug: string) {
  if (!process.env.PGSUPER_URL) return;
  const p = new pg.Pool({ connectionString: process.env.PGSUPER_URL });
  try { await p.query("update workspaces set slug = slug || '-old-' || substr(md5(random()::text), 1, 8) where slug = $1", [slug]); } finally { await p.end(); }
}

export async function api(u: U | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, baseUrl = BASE) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: baseUrl, ...headers };
  if (u?.cookie) h.cookie = u.cookie;
  return fetch(baseUrl + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

export async function inWs<T>(ws: string, f: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await ownerPool.connect();
  try { await c.query('begin'); await c.query("select set_config('app.workspace_id', $1, true)", [ws]); const r = await f(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}

export async function world() {
  const s = randomUUID().slice(0, 6);
  const w1 = randomUUID(), w2 = randomUUID(), t1 = randomUUID(), t2 = randomUUID(), t2w1 = randomUUID();
  const user = async (c: pg.PoolClient, ws: string, tag: string, role: string): Promise<U> => {
    const u = { id: randomUUID(), email: `${tag}-${s}@example.test` };
    await c.query('insert into users (id, email, password_hash, email_verified_at) values ($1,$2,$3,now())', [u.id, u.email, await (pwHash ??= hashPassword(PW))]);
    if (role) await c.query('insert into memberships (id, workspace_id, user_id, role) values ($1,$2,$3,$4)', [randomUUID(), ws, u.id, role]);
    return u;
  };
  const issue = (c: pg.PoolClient, ws: string, team: string, n: number, by: string) => {
    const id = randomUUID();
    return c.query('insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, ws, team, n, `seed ${n}`, `a${n}`, by])
      .then(() => c.query('update teams set issue_seq = greatest(issue_seq, $2) where id = $1', [team, n])).then(() => id);
  };
  // slugs w1/w2 are what the suites address (`/api/v1/w/w1`): reuse them if a previous file already seeded them.
  await freeSlug('w1'); await freeSlug('w2');
  const r1 = await inWs(w1, async (c) => {
    await c.query('insert into workspaces (id, slug, name) values ($1,$2,$2)', [w1, 'w1']);
    const A1 = await user(c, w1, 'a1', 'admin'), M1 = await user(c, w1, 'm1', 'member'), M2 = await user(c, w1, 'm2', 'member'), G1 = await user(c, w1, 'g1', 'guest');
    await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4), ($5,$2,$6,$7)', [t1, w1, 'Eng', 'ENG', t2w1, 'Ops', 'OPS']);
    await c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3), ($1,$2,$4)', [w1, t1, A1.id, M1.id]);
    await c.query('insert into labels (id, workspace_id, name) values ($1,$2,$3)', [randomUUID(), w1, 'bug']);
    const i1 = await issue(c, w1, t1, 1, M1.id);
    // T2/T3/T7 need an active share I1 -> G1 (v6)
    await c.query('insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values ($1,$2,$3,$4)', [w1, i1, G1.id, M1.id]);
    return { A1, M1, M2, G1, i1 };
  });
  const r2 = await inWs(w2, async (c) => {
    await c.query('insert into workspaces (id, slug, name) values ($1,$2,$2)', [w2, 'w2']);
    const B1 = await user(c, w2, 'b1', 'member');
    await c.query('insert into teams (id, workspace_id, name, key) values ($1,$2,$3,$4)', [t2, w2, 'Eng', 'ENG']);
    const i2 = await issue(c, w2, t2, 1, B1.id);
    return { B1, i2 };
  });
  const N = await inWs(w1, (c) => user(c, w1, 'n', '')); // registered, member of nothing
  const { A1, M1, M2, G1, i1 } = r1;
  for (const u of [A1, M1, M2, G1, N, r2.B1]) u.cookie = await loginAs(u.email);
  return { A1, M1, M2, G1, N, B1: r2.B1, t1, t2, t2w1, w1, w2, i1, i2: r2.i2,
    Nemail: N.email, M1email: M1.email, A1id: A1.id, G1id: G1.id };
}
