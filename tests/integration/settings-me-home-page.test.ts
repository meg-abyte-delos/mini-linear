import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ownerSql, appSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { createSession } from '../../src/lib/auth/session';
import { me, patchMe } from '../../src/lib/auth/service';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

// PATCH /me home_page: the landing page preference, persisted per user, validated against a fixed enum.
(haveDb ? describe : describe.skip)('PATCH /me home_page', () => {
  const owner = ownerSql(), app = appSql(); let seed: Seed; let cookie = ''; let other = '';
  const call = (h: typeof me, c: string | null, body?: unknown) => h(new Request('http://x/api/v1/me', {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: { 'content-type': 'application/json', ...(c ? { cookie: `ml_session=${c}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), app);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    cookie = await createSession(app, seed.a.member);
    other = await createSession(app, seed.a.admin);
  });
  afterAll(async () => { await app.end(); await owner.end(); });

  it('defaults to inbox', async () => {
    expect((await (await call(me, cookie)).json()).home_page).toBe('inbox');
  });
  it('persists each allowed value and leaves other fields untouched', async () => {
    for (const v of ['my-issues', 'projects', 'views', 'inbox']) {
      const r = await call(patchMe, cookie, { home_page: v });
      expect(r.status).toBe(200);
      expect((await r.json()).home_page).toBe(v);
      expect((await (await call(me, cookie)).json()).home_page).toBe(v);
    }
    const r = await call(patchMe, cookie, { theme: 'dark' });
    expect(await r.json()).toMatchObject({ theme: 'dark', home_page: 'inbox' });
  });
  it('is per user: another user keeps the default', async () => {
    await call(patchMe, cookie, { home_page: 'views' });
    expect((await (await call(me, other)).json()).home_page).toBe('inbox');
  });
  it('rejects values outside the enum (400+, never 500)', async () => {
    for (const v of ['settings', '', 'Inbox', null, 3]) {
      const s = (await call(patchMe, cookie, { home_page: v })).status;
      expect(s, String(v)).toBeGreaterThanOrEqual(400);
      expect(s).toBeLessThan(500);
    }
  });
  it('anonymous PATCH is 401', async () => {
    expect((await call(patchMe, null, { home_page: 'views' })).status).toBe(401);
  });
});
