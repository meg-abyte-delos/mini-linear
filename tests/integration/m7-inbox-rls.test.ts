import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from '../helpers/seed';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DATABASE_URL / DATABASE_OWNER_URL are unset: integration tests must not skip');
const run = haveDb ? describe : describe.skip;
type Tx = postgres.TransactionSql;

run('Area 7 inbox RLS + notify()', () => {
  const app = appSql(), owner = ownerSql();
  let seed: Seed; let teamA: string; let issueA: string; let commentA: string; let issueB: string; let nA: string;
  const asUser = (ws: string, user: string | null, fn: (tx: Tx) => Promise<postgres.RowList<postgres.Row[]>>) => withWorkspace(app, ws, fn, user);
  const ownerIn = <T,>(ws: string, fn: (tx: Tx) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return fn(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    let k = 0;
    const mk = (ws: string, member: string, admin: string) => ownerIn(ws, async (tx) => {
      const team = randomUUID(), issue = randomUUID(), comment = randomUUID(), key = ['QA', 'QB'][k++]!;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${ws}, 'Eng', ${key})`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${ws}, ${team}, ${member})`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values (${issue}, ${ws}, ${team}, 1, 't', 'a1', ${admin})`;
      await tx`insert into comments (id, workspace_id, issue_id, author_id, body) values (${comment}, ${ws}, ${issue}, ${admin}, 'hi')`;
      return { team, issue, comment };
    });
    const a = await mk(seed.a.id, seed.a.member, seed.a.admin), b = await mk(seed.b.id, seed.b.member, seed.b.admin);
    teamA = a.team; issueA = a.issue; commentA = a.comment; issueB = b.issue;
    nA = randomUUID();
    const ok = await asUser(seed.a.id, seed.a.admin, (tx) => tx`select notify(${nA}, ${seed.a.member}, 'comment', ${issueA}, ${commentA}) ok`);
    expect(ok[0]!.ok).toBe(true); // admin acts, member is notified
  });
  afterAll(async () => { await app.end(); await owner.end(); });

  it('recipient sees own notification', async () => {
    const rows = await asUser(seed.a.id, seed.a.member, (tx) => tx`select id from notifications`);
    expect(rows.map((r) => r.id)).toEqual([nA]);
  });
  it('NEGATIVE: admin and owner cannot read another user inbox', async () => {
    for (const u of [seed.a.admin, seed.a.owner, seed.a.guest]) {
      expect((await asUser(seed.a.id, u, (tx) => tx`select id from notifications`)).length).toBe(0);
      expect((await asUser(seed.a.id, u, (tx) => tx`select id from notifications where user_id = ${seed.a.member}`)).length).toBe(0);
    }
  });
  it('NEGATIVE: another user cannot update or delete it', async () => {
    expect((await asUser(seed.a.id, seed.a.admin, (tx) => tx`update notifications set read_at = now() where id = ${nA}`)).count).toBe(0);
    expect((await asUser(seed.a.id, seed.a.admin, (tx) => tx`delete from notifications where id = ${nA}`)).count).toBe(0);
    expect((await asUser(seed.a.id, seed.a.member, (tx) => tx`select id from notifications`)).length).toBe(1);
  });
  it('unset app.user_id, or the wrong workspace, returns zero rows', async () => {
    expect((await asUser(seed.a.id, null, (tx) => tx`select id from notifications`)).length).toBe(0);
    expect((await asUser(seed.b.id, seed.a.member, (tx) => tx`select id from notifications`)).length).toBe(0);
    expect((await withWorkspace(app, null, (tx) => tx`select id from notifications`, seed.a.member)).length).toBe(0);
  });
  it('app_user cannot insert a notification for someone else directly (only notify() can)', async () => {
    await expect(asUser(seed.a.id, seed.a.admin, (tx) => tx`insert into notifications (id, workspace_id, user_id, type, issue_id) values (${randomUUID()}, ${seed.a.id}, ${seed.a.member}, 'comment', ${issueA})`)).rejects.toThrow();
  });
  it('preferences and subscriptions are per user', async () => {
    await asUser(seed.a.id, seed.a.member, (tx) => tx`insert into notification_preferences (workspace_id, user_id, type, in_app) values (${seed.a.id}, ${seed.a.member}, 'mention', false)`);
    expect((await asUser(seed.a.id, seed.a.admin, (tx) => tx`select 1 from notification_preferences`)).length).toBe(0);
    await expect(asUser(seed.a.id, seed.a.admin, (tx) => tx`insert into notification_preferences (workspace_id, user_id, type) values (${seed.a.id}, ${seed.a.member}, 'comment')`)).rejects.toThrow();
    // subscriptions are issue_subscribers (0103, tenant RLS): a user may mute only their own row
    await ownerIn(seed.a.id, async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; await tx`insert into issue_subscribers (workspace_id, issue_id, user_id, reason) values (${seed.a.id}, ${issueA}, ${seed.a.member}, 'mention')`; });
    expect((await asUser(seed.a.id, seed.a.admin, (tx) => tx`update issue_subscribers set muted = true where user_id = ${seed.a.member} returning 1`)).length).toBe(0);
    expect((await asUser(seed.a.id, seed.a.member, (tx) => tx`update issue_subscribers set muted = true where user_id = ${seed.a.member} returning 1`)).length).toBe(1);
  });
  it('notify() rules: self, preference off, guest without share, other tenant, team scope, dedupe, share', async () => {
    const call = (user: string, recipient: string, type: string, issue: string, comment: string | null) =>
      asUser(seed.a.id, user, (tx) => tx`select notify(${randomUUID()}, ${recipient}, ${type}, ${issue}, ${comment}) ok`).then((r) => r[0]!.ok as boolean);
    expect(await call(seed.a.admin, seed.a.admin, 'comment', issueA, null)).toBe(false); // never self
    expect(await call(seed.a.admin, seed.a.member, 'mention', issueA, commentA)).toBe(false); // in_app off for mention
    expect(await call(seed.a.admin, seed.a.guest, 'comment', issueA, null)).toBe(false); // guest, no share
    expect(await call(seed.a.admin, seed.b.member, 'comment', issueA, null)).toBe(false); // member of another workspace
    expect(await call(seed.a.admin, seed.a.member, 'comment', issueB, null)).toBe(false); // other tenant's issue
    await ownerIn(seed.a.id, (tx) => tx`delete from team_memberships where team_id = ${teamA}`);
    expect(await call(seed.a.admin, seed.a.member, 'comment', issueA, null)).toBe(false); // member lost team access
    expect(await call(seed.a.admin, seed.a.owner, 'comment', issueA, null)).toBe(true); // owner sees every team
    expect(await call(seed.a.admin, seed.a.owner, 'mention', issueA, commentA)).toBe(true);
    expect(await call(seed.a.admin, seed.a.owner, 'mention', issueA, commentA)).toBe(false); // mention dedupe
    await ownerIn(seed.a.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${issueA}, ${seed.a.guest}, ${seed.a.admin})`);
    expect(await call(seed.a.admin, seed.a.guest, 'comment', issueA, null)).toBe(true); // active share
    await ownerIn(seed.a.id, (tx) => tx`update issue_shares set revoked_at = now() where guest_user_id = ${seed.a.guest}`);
    expect(await call(seed.a.admin, seed.a.guest, 'comment', issueA, null)).toBe(false); // revoked
  });
  it('notify() without a session user does nothing', async () => {
    const r = await asUser(seed.a.id, null, (tx) => tx`select notify(${randomUUID()}, ${seed.a.member}, 'comment', ${issueA}, null) ok`);
    expect(r[0]!.ok).toBe(false);
  });
});
