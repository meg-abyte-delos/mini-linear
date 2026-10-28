import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appSql, ownerSql, seedTwoWorkspaces, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { createIssue } from '../../src/lib/issues/handlers';
import { listNotifications, getUnreadCount, getNotification, deleteNotification, notificationAction, readAll, archiveRead } from '../../src/lib/resources/notifications';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

(haveDb ? describe : describe.skip)('Area 7 inbox API', () => {
  const owner = ownerSql(), app = appSql(); let seed: Seed; const team = randomUUID(); let current = '';
  // FORCE RLS applies to the owner too: set the tenant before touching tenant tables.
  const asOwner = (f: (tx: typeof owner) => Promise<unknown>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true), set_config('app.user_id', ${seed.a.member}, true)`; await f(tx as unknown as typeof owner); });
  const as = (u: string) => { current = u; };
  const post = (body?: unknown) => new Request('http://x/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const get = (qs = '') => new Request('http://x/api' + qs);
  const mk = async (assignee: string | null) => {
    const r = await createIssue(post({ team_id: team, title: 't', assignee_id: assignee }), seed.a.slug);
    expect(r.status).toBe(201);
  };
  const list = async (qs = '') => (await (await listNotifications(get(qs), seed.a.slug)).json()) as { items: { id: string; type: string; read_at: string | null; issue: { identifier: string } | null; actor: { id: string } | null }[]; next_cursor: string | null; unread_count: number };
  const act = (id: string, a: Parameters<typeof notificationAction>[3], body?: unknown) => notificationAction(post(body), seed.a.slug, id, a);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
    });
    setSessionResolver(async () => current);
    as(seed.a.admin);
    for (let i = 0; i < 5; i++) await mk(seed.a.member);
  });
  afterAll(async () => { await db().end(); await owner.end(); await app.end(); });

  it('lists newest first with embeds, unread_count, and cursor pagination', async () => {
    as(seed.a.member);
    const all = await list();
    expect(all.items.length).toBe(5); expect(all.unread_count).toBe(5);
    expect(all.items[0]!.issue!.identifier).toMatch(/^ENG-\d+$/); expect(all.items[0]!.actor!.id).toBe(seed.a.admin);
    const ids = all.items.map((n) => n.id); expect([...ids].sort().reverse()).toEqual(ids);
    const p1 = await list('?limit=2'); expect(p1.items.length).toBe(2); expect(p1.next_cursor).toBeTruthy();
    const p2 = await list(`?limit=10&cursor=${p1.next_cursor}`);
    expect([...p1.items, ...p2.items].map((n) => n.id)).toEqual(ids);
    expect((await list('?type=mention')).items.length).toBe(0);
    expect((await list('?type=assigned')).items.length).toBe(5);
    expect((await listNotifications(get('?type=bogus'), seed.a.slug)).status).toBe(422);
  });
  it('read / unread / archive / unarchive move counts and filters', async () => {
    as(seed.a.member);
    const [a, b, c] = (await list()).items;
    const r = await act(a!.id, 'read'); expect(r.status).toBe(200); expect((await r.json()).read_at).toBeTruthy();
    expect((await (await getUnreadCount(get(), seed.a.slug)).json()).unread_count).toBe(4);
    expect((await list('?unread=true')).items.length).toBe(4);
    await act(a!.id, 'unread'); expect((await list()).unread_count).toBe(5);
    await act(b!.id, 'archive');
    expect((await list()).items.length).toBe(4);
    expect((await list('?archived=true')).items.map((n) => n.id)).toEqual([b!.id]);
    expect((await list()).unread_count).toBe(4); // archive marks read
    await act(b!.id, 'unarchive'); expect((await list()).items.length).toBe(5);
    void c;
  });
  it('snooze hides until the time; past and >1y are 422; bad body is 422', async () => {
    as(seed.a.member);
    const n = (await list()).items[0]!;
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect((await act(n.id, 'snooze', { until: future })).status).toBe(200);
    expect((await list()).items.some((x) => x.id === n.id)).toBe(false);
    expect((await list('?snoozed=true')).items.map((x) => x.id)).toEqual([n.id]);
    expect((await act(n.id, 'snooze', { until: new Date(Date.now() - 1000).toISOString() })).status).toBe(422);
    expect((await act(n.id, 'snooze', { until: new Date(Date.now() + 400 * 86_400_000).toISOString() })).status).toBe(422);
    expect((await act(n.id, 'snooze', {})).status).toBe(422);
    expect((await act(n.id, 'snooze', { until: new Date(Date.now() + 364 * 86_400_000).toISOString() })).status).toBe(200);
    await asOwner((tx) => tx`update notifications set snoozed_until = now() - interval '1 second' where id = ${n.id}`); // elapsed => visible again
    expect((await list()).items.some((x) => x.id === n.id)).toBe(true);
  });
  it('read-all and archive-read', async () => {
    as(seed.a.member);
    expect((await (await readAll(post(), seed.a.slug)).json()).updated).toBeGreaterThan(0);
    expect((await list()).unread_count).toBe(0);
    expect((await (await archiveRead(post(), seed.a.slug)).json()).updated).toBeGreaterThan(0);
    expect((await list()).items.length).toBe(0);
    expect((await list('?archived=true')).items.length).toBe(5);
  });
  it('another user, another workspace, unknown and malformed ids all give the same 404; delete works for the owner only', async () => {
    as(seed.a.member);
    const mine = (await list('?archived=true')).items[0]!.id;
    as(seed.a.admin);
    const bodies: string[] = [];
    for (const id of [mine, randomUUID(), 'nope']) {
      const r = await getNotification(get(), seed.a.slug, id); expect(r.status).toBe(404);
      const w = await act(id, 'read'); expect(w.status).toBe(404);
      const d = await deleteNotification(get(), seed.a.slug, id); expect(d.status).toBe(404);
      bodies.push((await r.json()).error.message);
    }
    expect(new Set(bodies).size).toBe(1);
    as(seed.b.admin);
    expect((await getNotification(get(), seed.b.slug, mine)).status).toBe(404);
    as(seed.a.member);
    expect((await deleteNotification(get(), seed.a.slug, mine)).status).toBe(204);
    expect((await getNotification(get(), seed.a.slug, mine)).status).toBe(404);
  });
  it('a notification whose issue the user can no longer see is hidden', async () => {
    as(seed.a.admin);
    await mk(seed.a.member);
    as(seed.a.member);
    const n = (await list()).items[0]!; expect(n).toBeTruthy();
    await asOwner((tx) => tx`update issues set deleted_at = now() where id = (select issue_id from notifications where id = ${n.id})`);
    expect((await list()).items.some((x) => x.id === n.id)).toBe(false);
    expect((await getNotification(get(), seed.a.slug, n.id)).status).toBe(404);
  });
});
