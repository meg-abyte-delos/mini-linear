import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { createIssue } from '../../src/lib/issues/handlers';
import { deleteWorkspace } from '../../src/lib/resources/tenancy';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

// DELETE /w/:slug: owner only; the cascade must leave no row behind in any tenant table, and other workspaces stay intact.
(haveDb ? describe : describe.skip)('DELETE /w/:slug', () => {
  const owner = ownerSql(); let seed: Seed; let current = ''; const team = randomUUID();
  const req = (method = 'DELETE', body?: unknown) => new Request('http://x/api', { method, headers: { origin: 'http://x', host: 'x', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const inWs = <T,>(id: string, f: (tx: postgres.TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${id}, true)`; return f(tx); }) as Promise<T>;
  /** Every table carrying a workspace_id column, with its row count for that workspace. */
  const rowsLeft = async (id: string) => {
    const tables = await owner<{ table_name: string }[]>`select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
      where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'`;
    const out: Record<string, number> = {};
    for (const { table_name } of tables) out[table_name] = await inWs(id, async (tx) => Number((await tx.unsafe(`select count(*)::int as n from "${table_name}"`))[0]!.n));
    return out;
  };
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    for (const w of [seed.a, seed.b]) await inWs(w.id, async (tx) => {
      const t = w === seed.a ? team : randomUUID();
      await tx`insert into teams (id, workspace_id, name, key) values (${t}, ${w.id}, 'Eng', ${w === seed.a ? 'ENG' : 'BNG'})`;
      for (const u of [w.owner, w.member]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${w.id}, ${t}, ${u})`;
      await tx`insert into labels (id, workspace_id, name, color) values (${randomUUID()}, ${w.id}, 'bug', '#ff0000')`;
      await tx`insert into invites (id, workspace_id, email, role, token_hash, invited_by, expires_at) values (${randomUUID()}, ${w.id}, 'x@example.test', 'member', ${randomUUID()}, ${w.owner}, now() + interval '7 days')`;
    });
    setSessionResolver(async () => current);
    current = seed.a.owner;
    expect((await createIssue(req('POST', { team_id: team, title: 'to be deleted' }), seed.a.slug)).status).toBe(201);
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it('admin, member, guest get 403 and nothing is deleted', async () => {
    for (const u of [seed.a.admin, seed.a.member, seed.a.guest]) { current = u; expect((await deleteWorkspace(req(), seed.a.slug)).status, u).toBe(403); }
    expect((await rowsLeft(seed.a.id))['issues']).toBe(1);
  });
  it('a non-member (owner of another workspace) gets 404 and an anonymous caller 401', async () => {
    current = seed.b.owner; expect((await deleteWorkspace(req(), seed.a.slug)).status).toBe(404);
    current = ''; expect((await deleteWorkspace(req(), seed.a.slug)).status).toBe(401);
    expect((await rowsLeft(seed.a.id))['teams']).toBe(1);
  });
  it('owner gets 204, no orphan row remains in any tenant table, the other workspace is untouched, users survive', async () => {
    const before = await rowsLeft(seed.b.id);
    const populated = Object.entries(await rowsLeft(seed.a.id)).filter(([, n]) => n > 0).map(([k]) => k);
    expect(populated).toEqual(expect.arrayContaining(['teams', 'team_memberships', 'labels', 'invites', 'issues', 'memberships', 'audit_events']));
    current = seed.a.owner;
    expect((await deleteWorkspace(req(), seed.a.slug)).status).toBe(204);
    const left = await rowsLeft(seed.a.id);
    expect(Object.fromEntries(Object.entries(left).filter(([, n]) => n > 0))).toEqual({});
    expect(await rowsLeft(seed.b.id)).toEqual(before);
    expect((await owner`select count(*)::int as n from users where id = ${seed.a.owner}`)[0]!.n).toBe(1);
    expect((await deleteWorkspace(req(), seed.a.slug)).status).toBe(404); // gone: the owner is no longer a member
  });
});
