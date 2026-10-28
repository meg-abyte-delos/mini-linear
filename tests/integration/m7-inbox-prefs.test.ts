import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { appSql, ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { getPreferences, putPreferences } from '../../src/lib/resources/notifications';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

(haveDb ? describe : describe.skip)('Area 7 notification preferences', () => {
  const owner = ownerSql(), app = appSql(); let seed: Seed; let current = '';
  const put = (b: unknown) => putPreferences(new Request('http://x/api', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }), seed.a.slug);
  const get = async () => (await (await getPreferences(new Request('http://x/api'), seed.a.slug)).json()) as { preferences: Record<string, { in_app: boolean; email: boolean }> };
  beforeAll(async () => { seed = await seedTwoWorkspaces(owner); setSessionResolver(async () => current); });
  afterAll(async () => { await db().end(); await owner.end(); await app.end(); });

  it('returns defaults for all 5 types', async () => {
    current = seed.a.member;
    const p = (await get()).preferences;
    expect(Object.keys(p).sort()).toEqual(['assigned', 'comment', 'due_soon', 'mention', 'status_change']);
    expect(p.comment).toEqual({ in_app: true, email: false });
  });
  it('partial PUT upserts and keeps the other flag; stays per user', async () => {
    current = seed.a.member;
    expect((await put({ preferences: { comment: { email: true }, mention: { in_app: false } } })).status).toBe(200);
    let p = (await get()).preferences;
    expect(p.comment).toEqual({ in_app: true, email: true }); expect(p.mention).toEqual({ in_app: false, email: false });
    await put({ preferences: { comment: { in_app: false } } });
    p = (await get()).preferences; expect(p.comment).toEqual({ in_app: false, email: true });
    current = seed.a.admin;
    expect((await get()).preferences.comment).toEqual({ in_app: true, email: false });
  });
  it('rejects unknown types, unknown keys and non-boolean values with 4xx', async () => {
    current = seed.a.member;
    for (const b of [{ preferences: { bogus: { email: true } } }, { preferences: { comment: { sms: true } } }, { preferences: { comment: { email: 'yes' } } }, {}]) {
      const r = await put(b); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
    }
  });
});
