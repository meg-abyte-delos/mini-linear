import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { createIssue } from '../../src/lib/issues/handlers';
import { listNotifications } from '../../src/lib/resources/notifications';
import { listMembers, listTeamMembers } from '../../src/lib/resources/tenancy';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

// The UI shows people by display name: the members list, the team members list and the notification actor must carry display_name, not just the email.
(haveDb ? describe : describe.skip)('API exposes display_name for members and notification actors', () => {
  const owner = ownerSql(); let seed: Seed; const team = randomUUID(); let current = '';
  const req = (body?: unknown) => new Request('http://x/api?limit=100', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    await owner`update users set display_name = 'Sam Okafor' where id = ${seed.a.admin}`;
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
    });
    setSessionResolver(async () => current);
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('members and team members list carry display_name', async () => {
    current = seed.a.admin;
    const m = (await (await listMembers(req(), seed.a.slug)).json()) as { items: { user_id: string; display_name: string | null }[] };
    expect(m.items.find((x) => x.user_id === seed.a.admin)!.display_name).toBe('Sam Okafor');
    const t = (await (await listTeamMembers(req(), seed.a.slug, team)).json()) as { items: { user_id: string; display_name: string | null }[] };
    expect(t.items.find((x) => x.user_id === seed.a.admin)!.display_name).toBe('Sam Okafor');
  });

  it('notification actor carries display_name', async () => {
    current = seed.a.admin;
    expect((await createIssue(req({ team_id: team, title: 't', assignee_id: seed.a.member }), seed.a.slug)).status).toBe(201);
    current = seed.a.member;
    const n = (await (await listNotifications(req(), seed.a.slug)).json()) as { items: { actor: { id: string; email: string; display_name: string | null } | null }[] };
    const a = n.items[0]!.actor!;
    expect(a.id).toBe(seed.a.admin); expect(a.display_name).toBe('Sam Okafor'); expect(a.email).toBeTruthy();
  });
});
