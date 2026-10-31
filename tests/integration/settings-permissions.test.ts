import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { resendInvite, deleteInvite, deleteTeam } from '../../src/lib/resources/tenancy';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

// Settings permissions: invite resend/revoke and team delete are admin/owner only (403 below, 404 for a non-member or another workspace's id).
(haveDb ? describe : describe.skip)('settings permissions: invite resend, invite revoke, team delete', () => {
  const owner = ownerSql(); let seed: Seed; let current = '';
  const req = (method: string) => new Request('http://x/api', { method, headers: { origin: 'http://x', host: 'x' } });
  const mkInvite = async (ws: Seed['a'], email = `i-${randomUUID().slice(0, 8)}@example.test`) => {
    const id = randomUUID();
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws.id}, true)`;
      await tx`insert into invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) values (${id}, ${ws.id}, ${email}, 'member', ${randomUUID()}, ${ws.owner}, now() + interval '7 days')`;
    });
    return id;
  };
  const mkTeam = async (ws: Seed['a']) => {
    const id = randomUUID(), key = 'T' + randomUUID().replace(/[^a-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${id}, ${ws.id}, 'Tmp', ${key})`;
    });
    return id;
  };
  const revokedAt = async (ws: Seed['a'], id: string) => owner.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${ws.id}, true)`;
    return (await tx<{ revoked_at: Date | null }[]>`select revoked_at from invites where id = ${id}`)[0]!.revoked_at;
  });
  const teamExists = async (ws: Seed['a'], id: string) => owner.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${ws.id}, true)`;
    return (await tx`select 1 from teams where id = ${id}`).length === 1;
  });
  beforeAll(async () => { seed = await seedTwoWorkspaces(owner); setSessionResolver(async () => current); });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('resend: member and guest 403, outsider 404, other workspace id 404, admin/owner 200', async () => {
    const inv = await mkInvite(seed.a);
    for (const u of [seed.a.member, seed.a.guest]) { current = u; expect((await resendInvite(req('POST'), seed.a.slug, inv)).status, u).toBe(403); }
    current = seed.b.owner; expect((await resendInvite(req('POST'), seed.a.slug, inv)).status).toBe(404);
    current = seed.a.owner; expect((await resendInvite(req('POST'), seed.a.slug, await mkInvite(seed.b))).status).toBe(404);
    for (const u of [seed.a.admin, seed.a.owner]) { current = u; expect((await resendInvite(req('POST'), seed.a.slug, inv)).status, u).toBe(200); }
  });
  it('revoke: member and guest 403 and the invite stays live, outsider 404, admin 204', async () => {
    const inv = await mkInvite(seed.a);
    for (const u of [seed.a.member, seed.a.guest]) { current = u; expect((await deleteInvite(req('DELETE'), seed.a.slug, inv)).status, u).toBe(403); }
    current = seed.b.owner; expect((await deleteInvite(req('DELETE'), seed.a.slug, inv)).status).toBe(404);
    expect(await revokedAt(seed.a, inv)).toBeNull();
    current = seed.a.admin; expect((await deleteInvite(req('DELETE'), seed.a.slug, inv)).status).toBe(204);
    expect(await revokedAt(seed.a, inv)).not.toBeNull();
    expect((await deleteInvite(req('DELETE'), seed.a.slug, inv)).status).toBe(404); // already revoked
  });
  it('delete team: member and guest 403 and the team stays, outsider 404, admin and owner 204', async () => {
    const t = await mkTeam(seed.a);
    for (const u of [seed.a.member, seed.a.guest]) { current = u; expect((await deleteTeam(req('DELETE'), seed.a.slug, t)).status, u).toBe(403); }
    current = seed.b.owner; expect((await deleteTeam(req('DELETE'), seed.a.slug, t)).status).toBe(404);
    expect(await teamExists(seed.a, t)).toBe(true);
    current = seed.a.admin; expect((await deleteTeam(req('DELETE'), seed.a.slug, t)).status).toBe(204);
    expect(await teamExists(seed.a, t)).toBe(false);
    const t2 = await mkTeam(seed.a);
    current = seed.a.owner; expect((await deleteTeam(req('DELETE'), seed.a.slug, t2)).status).toBe(204);
    expect((await deleteTeam(req('DELETE'), seed.a.slug, t2)).status).toBe(404);
  });
});
