/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment -- TODO(M1) draft suite */
// @ts-nocheck TODO(M1): black-box suite drafted before the M1 routes exist; remove once typed against the real API.
import { describe, it, expect } from 'vitest';
import { ownerPool } from './helpers/world';
import { runIntegration } from './helpers/gate';
void runIntegration;
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const ORIGIN = BASE;
const raw = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method, redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
const uniq = () => `u${Date.now()}${Math.floor(Math.random() * 1e6)}@example.test`;
const PW = 'correct horse battery staple';
const signup = async (email = uniq(), password = PW) => ({ email, r: await raw('POST', '/api/v1/auth/signup', { email, password, name: 'T' }) });
const login = (email: string, password: string, h = {}) => raw('POST', '/api/v1/auth/login', { email, password }, h);
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];
const verified = async () => {
  const { email } = await signup();
  await ownerPool.query('update users set email_verified_at=now() where email=$1', [email]);
  return email;
};

// TODO(M1)
describe.skip('T4 signup and passwords', () => {
  it('password under 12 chars rejected', async () => expect((await signup(uniq(), 'short-11-ch')).r.status).toBe(422));
  it('breached password rejected', async () => expect((await signup(uniq(), 'password1234')).r.status).toBe(422));
  it('no composition rules: 12 lowercase letters accepted', async () => expect([200, 201]).toContain((await signup(uniq(), 'qzxwvbnmlkjh')).r.status));
  it('hash is argon2id', async () => {
    const { email } = await signup();
    const h = (await ownerPool.query('select password_hash h from users where email=$1', [email])).rows[0].h;
    expect(h).toMatch(/^\$argon2id\$/);
  });
  it('unverified user cannot join a workspace', async () => {
    const { email } = await signup();
    const c = (await login(email, PW)).headers.get('set-cookie') ?? '';
    const r = await raw('POST', '/api/v1/invites/accept', { token: 'x'.repeat(43) }, { cookie: c.split(';')[0] });
    expect([403, 404]).toContain(r.status);
    expect((await ownerPool.query('select count(*)::int n from memberships m join users u on u.id=m.user_id where u.email=$1', [email])).rows[0].n).toBe(0);
  });
});

// TODO(M1)
describe.skip('T4 login', () => {
  it('wrong password and unknown email: same status and body', async () => {
    const { email } = await signup();
    const a = await login(email, 'wrong-password-123'); const b = await login(uniq(), 'wrong-password-123');
    expect(a.status).toBe(b.status);
    const norm = (s: string) => s.replace(/"request_?id":"[^"]*"/i, '');
    expect(norm(await a.text())).toBe(norm(await b.text()));
  });
  it('p50 timing difference under 20 ms over 50 runs', async () => {
    const { email } = await signup(); const t1: number[] = [], t2: number[] = [];
    for (let i = 0; i < 50; i++) {
      let s = performance.now(); await login(email, 'wrong-password-123'); t1.push(performance.now() - s);
      s = performance.now(); await login(`nobody${i}@example.test`, 'wrong-password-123'); t2.push(performance.now() - s);
    }
    expect(Math.abs(median(t1) - median(t2))).toBeLessThan(20);
  }, 60_000);
  it('10 failures lock the account, valid password refused too', async () => {
    const { email } = await signup();
    for (let i = 0; i < 10; i++) await login(email, 'wrong-password-123', { 'x-forwarded-for': `10.9.0.${i}` });
    const r = await login(email, PW, { 'x-forwarded-for': '10.9.1.1' });
    expect([401, 423, 429]).toContain(r.status);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('IP rate limit is independent of the account lockout', async () => {
    const ip = { 'x-forwarded-for': '10.7.7.7' }; let last = 0;
    for (let i = 0; i < 40; i++) last = (await login(uniq(), 'wrong-password-123', ip)).status;
    expect(last).toBe(429);
    const { email } = await signup();
    expect((await login(email, PW, { 'x-forwarded-for': '10.7.7.8' })).status).toBe(200);
  });
});

// TODO(M1)
describe.skip('T4 sessions', () => {
  it('session id rotates on login', async () => {
    const e = await verified();
    const a = cookieOf(await login(e, PW)); const b = cookieOf(await login(e, PW));
    expect(a).toBeTruthy(); expect(a).not.toBe(b);
  });
  it('logout invalidates server-side', async () => {
    const e = await verified(); const c = cookieOf(await login(e, PW));
    expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(200);
    await raw('POST', '/api/v1/auth/logout', {}, { cookie: c });
    expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(401);
  });
  it('logout-all invalidates every session', async () => {
    const e = await verified(); const c1 = cookieOf(await login(e, PW)); const c2 = cookieOf(await login(e, PW));
    await raw('POST', '/api/v1/auth/logout-all', {}, { cookie: c1 });
    for (const c of [c1, c2]) expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(401);
  });
  it('expired session -> 401', async () => {
    const e = await verified(); const c = cookieOf(await login(e, PW));
    await ownerPool.query(`update sessions set expires_at = now() - interval '1 minute' where user_id=(select id from users where email=$1)`, [e]);
    expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(401);
  });
  it('cookie flags follow S10', async () => {
    const sc = (await login(await verified(), PW)).headers.get('set-cookie') ?? '';
    expect(sc).toMatch(/^__Host-/); expect(sc).toMatch(/HttpOnly/i); expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i); expect(sc).toMatch(/Path=\//); expect(sc).not.toMatch(/Domain=/i);
  });
});

// TODO(M1): needs a test hook to read reset tokens.
describe.skip('T4 password reset', () => {
  const tokenFor = async (email: string) => {
    await raw('POST', '/api/v1/auth/password-reset/request', { email });
    return (await ownerPool.query(`select test_token t from password_resets pr join users u on u.id=pr.user_id where u.email=$1 order by pr.created_at desc limit 1`, [email])).rows[0]?.t as string;
  };
  it('unknown and known emails get the same response', async () => {
    const a = await raw('POST', '/api/v1/auth/password-reset/request', { email: await verified() });
    const b = await raw('POST', '/api/v1/auth/password-reset/request', { email: uniq() });
    expect(a.status).toBe(b.status); expect(await a.text()).toBe(await b.text());
  });
  it('unknown and expired tokens get the same response', async () => {
    const e = await verified(); const t = await tokenFor(e);
    await ownerPool.query(`update password_resets set expires_at = now() - interval '1 second' where user_id=(select id from users where email=$1)`, [e]);
    const a = await raw('POST', '/api/v1/auth/password-reset/confirm', { token: t, password: 'a-new-long-password' });
    const b = await raw('POST', '/api/v1/auth/password-reset/confirm', { token: 'z'.repeat(43), password: 'a-new-long-password' });
    expect(a.status).toBe(b.status); expect(await a.text()).toBe(await b.text());
  });
  it('token lasts 1 h, is single use, and a reset revokes all sessions', async () => {
    const e = await verified(); const c = cookieOf(await login(e, PW)); const t = await tokenFor(e);
    const ttl = (await ownerPool.query(`select extract(epoch from expires_at - created_at) s from password_resets order by created_at desc limit 1`)).rows[0].s;
    expect(Number(ttl)).toBeLessThanOrEqual(3600);
    expect((await raw('POST', '/api/v1/auth/password-reset/confirm', { token: t, password: 'a-new-long-password' })).status).toBe(200);
    expect([400, 404]).toContain((await raw('POST', '/api/v1/auth/password-reset/confirm', { token: t, password: 'another-long-password' })).status);
    expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(401);
  });
});

// TODO(M1)
describe.skip('T4 CSRF', () => {
  it.each([['missing', {}], ['foreign', { origin: 'https://evil.example' }]])('%s Origin on mutating requests -> 403', async (_n, h) => {
    const c = cookieOf(await login(await verified(), PW));
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      const r = await fetch(BASE + '/api/v1/auth/logout-all', { method: m, headers: { cookie: c, 'content-type': 'application/json', ...(h as any) }, body: m === 'DELETE' ? undefined : '{}' });
      expect(r.status).toBe(403);
    }
    expect((await raw('GET', '/api/v1/me', undefined, { cookie: c })).status).toBe(200);
  });
  it('GET never mutates', async () => {
    const before = (await ownerPool.query('select count(*)::int n from audit_events')).rows[0].n;
    await raw('GET', '/api/v1/me'); await raw('GET', '/api/v1/auth/logout');
    expect((await ownerPool.query('select count(*)::int n from audit_events')).rows[0].n).toBe(before);
  });
});
