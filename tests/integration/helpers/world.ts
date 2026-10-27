import { Pool } from 'pg';
export const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
export const appPool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
export const ownerPool = new Pool({ connectionString: process.env.OWNER_DATABASE_URL });
export type Actor = { cookie: string; userId: string };
export async function login(email: string, password: string): Promise<Actor> {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const me = await (await fetch(`${BASE}/api/v1/me`, { headers: { cookie } })).json();
  return { cookie, userId: me.id };
}
export function api(actor: Actor | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, { method,
    headers: { 'content-type': 'application/json', origin: BASE, ...(actor ? { cookie: actor.cookie } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
// Seed contract: global-setup creates W1/W2 and the users with the password below.
export const PASSWORD = 'correct horse battery staple';
export async function world() {
  const [A1, M1, M2, G1, B1, N] = await Promise.all(
    ['a1', 'm1', 'm2', 'g1', 'b1', 'n'].map((u) => login(`${u}@test.local`, PASSWORD)));
  const ids = (await ownerPool.query(
    `select (select id from workspaces where slug='w1') w1,
            (select id from workspaces where slug='w2') w2,
            (select id from teams where workspace_id=(select id from workspaces where slug='w1') limit 1) t1,
            (select id from issues where title='I1' limit 1) i1,
            (select id from issues where title='I2' limit 1) i2`)).rows[0];
  return { A1, M1, M2, G1, B1, N, ...ids };
}
