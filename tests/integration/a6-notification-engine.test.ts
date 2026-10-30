import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { appSql, ownerSql, seedTwoWorkspaces, withWorkspace, type Seed } from '../helpers/seed';
import { db, setSessionResolver } from '../../src/lib/http/ctx';
import { createIssue, patchIssue } from '../../src/lib/issues/handlers';
import { createComment } from '../../src/lib/resources/projects-comments';
import { createRelation } from '../../src/lib/issues/relations';
import { bulkNotifications, listNotifications } from '../../src/lib/resources/notifications';
import { listEntitySubscriptions, entitySubscription } from '../../src/lib/resources/entity-subscriptions';
import { dueSoon } from '../../src/lib/resources/due-soon';
import { getFeed } from '../../src/lib/sync/server/feed';
import { emitSync } from '../../src/lib/sync/emit';

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error('CI=true but DB urls unset: integration tests must not skip');

(haveDb ? describe : describe.skip)('A6 notification engine: producers, coalescing, entity subscriptions, bulk, cron, realtime', () => {
  const owner = ownerSql(), app = appSql(); let seed: Seed; const team = randomUUID(), project = randomUUID(), label = randomUUID(); let current = '';
  const as = (u: string) => { current = u; };
  const req = (method: string, body?: unknown, headers: Record<string, string> = {}) => new Request('http://x/api', { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const inbox = (u: string) => withWorkspace(app, seed.a.id, (tx) => tx`select id, type, issue_id, comment_id, actor_id, coalesced_count, meta, read_at from notifications order by id`, u);
  const mk = async (body: Record<string, unknown> = {}) => {
    const r = await createIssue(req('POST', { team_id: team, title: 't', ...body }), seed.a.slug);
    expect(r.status).toBe(201);
    return (await r.json()) as { id: string; version: number };
  };
  const patch = async (i: { id: string; version: number }, body: Record<string, unknown>) => {
    const r = await patchIssue(req('PATCH', body, { 'if-match': `"${i.version}"` }), seed.a.slug, i.id);
    expect(r.status).toBe(200);
    return (await r.json()) as { id: string; version: number };
  };
  const types = async (u: string, issue: string) => (await inbox(u)).filter((n) => n.issue_id === issue).map((n) => n.type);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    await owner.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`;
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
      await tx`insert into projects (id, workspace_id, name) values (${project}, ${seed.a.id}, 'P')`;
      await tx`insert into labels (id, workspace_id, name) values (${label}, ${seed.a.id}, 'L')`;
    });
    setSessionResolver(async () => current);
  });
  afterAll(async () => { await db().end(); await owner.end(); await app.end(); });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it('status change carries meta {from,to}; a second change while unread coalesces (count 2, latest to, first from)', async () => {
    as(seed.a.admin);
    const i = await mk({ assignee_id: seed.a.member });
    const s1 = await patch(i, { status: 'in_progress' });
    await patch(s1, { status: 'in_review' });
    const n = (await inbox(seed.a.member)).filter((x) => x.issue_id === i.id && x.type === 'status_change');
    expect(n.length).toBe(1);
    expect(n[0]!.coalesced_count).toBe(2);
    expect(n[0]!.meta).toEqual({ from: 'backlog', to: 'in_review' });
    expect(n[0]!.actor_id).toBe(seed.a.admin); // the definer updated ANOTHER user's unread row
  });
  it('a read notification does not coalesce; mention and assigned never coalesce', async () => {
    as(seed.a.admin);
    const i = await mk({ assignee_id: seed.a.member });
    const s1 = await patch(i, { status: 'todo' });
    const first = (await inbox(seed.a.member)).find((x) => x.issue_id === i.id && x.type === 'status_change')!;
    await withWorkspace(app, seed.a.id, (tx) => tx`update notifications set read_at = now() where id = ${first.id}`, seed.a.member);
    await patch(s1, { status: 'done' });
    const rows = (await inbox(seed.a.member)).filter((x) => x.issue_id === i.id && x.type === 'status_change');
    expect(rows.map((x) => x.coalesced_count)).toEqual([1, 1]);
    as(seed.a.member);
    for (let k = 0; k < 2; k++) await createComment(req('POST', { body: `hey @[Ad](${seed.a.admin}) ${k}` }), seed.a.slug, i.id);
    expect((await types(seed.a.admin, i.id)).filter((t) => t === 'mention').length).toBe(2);
  });
  it('comments coalesce into one row per issue; replies notify the thread author and followers with type reply', async () => {
    as(seed.a.admin);
    const i = await mk();
    as(seed.a.member);
    const c1 = (await (await createComment(req('POST', { body: 'one' }), seed.a.slug, i.id)).json()) as { id: string };
    await createComment(req('POST', { body: 'two' }), seed.a.slug, i.id);
    const a = (await inbox(seed.a.admin)).filter((x) => x.issue_id === i.id);
    expect(a.map((x) => [x.type, x.coalesced_count])).toEqual([['comment', 2]]);
    as(seed.a.admin);
    await createComment(req('POST', { body: 'reply', parent_comment_id: c1.id }), seed.a.slug, i.id);
    expect(await types(seed.a.member, i.id)).toEqual(['reply']);
    expect(await types(seed.a.admin, i.id)).toEqual(['comment']); // the actor of the reply gets nothing new
  });
  it('sub_issue: a child created or attached notifies followers of the parent, not the actor', async () => {
    as(seed.a.admin);
    const parent = await mk({ assignee_id: seed.a.member });
    as(seed.a.member);
    const child = await mk({ parent_id: parent.id });
    expect((await inbox(seed.a.admin)).filter((x) => x.issue_id === parent.id).map((x) => x.type)).toEqual(['sub_issue']);
    expect((await inbox(seed.a.admin)).find((x) => x.issue_id === parent.id)!.meta).toEqual({ child_id: child.id });
    as(seed.a.admin);
    const loose = await mk();
    await patch(loose, { parent_id: parent.id });
    expect((await types(seed.a.member, parent.id)).filter((t) => t === 'sub_issue').length).toBe(1);
    expect((await inbox(seed.a.member)).find((x) => x.issue_id === parent.id && x.type === 'sub_issue')!.coalesced_count).toBe(1);
  });
  it('relation notifies followers of both ends', async () => {
    as(seed.a.admin);
    const a = await mk({ assignee_id: seed.a.member });
    const b = await mk();
    as(seed.a.member);
    const r = await createRelation(req('POST', { type: 'related', related_issue_id: b.id }), seed.a.slug, a.id);
    expect(r.status).toBe(201);
    expect(await types(seed.a.admin, b.id)).toEqual(['relation']);
    expect(await types(seed.a.member, a.id)).toEqual(['assigned']); // actor excluded
  });
  it('entity subscriptions: effect on create and move, visibility, limits and roles', async () => {
    as(seed.a.member);
    const put = (kind: string, id: string) => entitySubscription(req('PUT'), seed.a.slug, kind, id);
    expect((await put('project', project)).status).toBe(204);
    expect((await put('project', project)).status).toBe(204); // idempotent
    expect((await put('label', label)).status).toBe(204);
    expect((await put('project', randomUUID())).status).toBe(404);
    expect((await put('nope', project)).status).toBe(422);
    expect((await put('project', 'not-a-uuid')).status).toBe(422);
    const list = (await (await listEntitySubscriptions(req('GET'), seed.a.slug)).json()) as { items: { kind: string }[] };
    expect(list.items.map((x) => x.kind).sort()).toEqual(['label', 'project']);
    as(seed.a.admin);
    const i = await mk({ project_id: project });
    expect((await inbox(seed.a.member)).find((x) => x.issue_id === i.id)).toMatchObject({ type: 'sub_issue', meta: { reason: 'followed_project' } });
    const j = await mk();
    await patch(j, { label_ids: [label] });
    expect((await inbox(seed.a.member)).find((x) => x.issue_id === j.id)).toMatchObject({ type: 'sub_issue', meta: { reason: 'followed_label' } });
    // another user never sees my subscriptions through a direct select; entity_subscribers (definer) does
    const direct = await withWorkspace(app, seed.a.id, (tx) => tx`select user_id from entity_subscriptions`, seed.a.admin);
    expect(direct.length).toBe(0);
    const viaFn = await withWorkspace(app, seed.a.id, (tx) => tx`select entity_subscribers as u from entity_subscribers('project', ${project}::uuid)`, seed.a.admin);
    expect(viaFn.map((x) => x.u)).toEqual([seed.a.member]);
    expect((await entitySubscription(req('DELETE'), seed.a.slug, 'project', project)).status).toBe(204);
    as(seed.a.guest);
    expect((await listEntitySubscriptions(req('GET'), seed.a.slug)).status).toBe(403);
    expect((await entitySubscription(req('PUT'), seed.a.slug, 'project', project)).status).toBe(403);
  });
  it('preference off for a new type skips it (reply)', async () => {
    await withWorkspace(app, seed.a.id, (tx) => tx`insert into notification_preferences (workspace_id, user_id, type, in_app) values (${seed.a.id}, ${seed.a.member}, 'reply', false)`, seed.a.member);
    as(seed.a.admin);
    const i = await mk();
    as(seed.a.member);
    const c = (await (await createComment(req('POST', { body: 'x' }), seed.a.slug, i.id)).json()) as { id: string };
    as(seed.a.admin);
    await createComment(req('POST', { body: 'y', parent_comment_id: c.id }), seed.a.slug, i.id);
    expect(await types(seed.a.member, i.id)).toEqual([]);
  });
  it('bulk: per-id results, hidden/unknown ids are not_found, unread_count, validation', async () => {
    as(seed.a.admin);
    const i = await mk({ assignee_id: seed.a.member }), j = await mk({ assignee_id: seed.a.member });
    const mine = (await inbox(seed.a.member)).filter((x) => [i.id, j.id].includes(x.issue_id)).map((x) => x.id);
    as(seed.a.member);
    const ghost = randomUUID();
    const r = await bulkNotifications(req('POST', { ids: [...mine, ghost], action: 'read' }), seed.a.slug);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { updated: number; results: { id: string; status: string }[]; unread_count: number };
    expect(body.updated).toBe(2);
    expect(body.results.find((x) => x.id === ghost)!.status).toBe('not_found');
    const un = await bulkNotifications(req('POST', { ids: mine, action: 'unread' }), seed.a.slug);
    expect(((await un.json()) as { updated: number }).updated).toBe(2);
    expect((await bulkNotifications(req('POST', { ids: mine, action: 'archive' }), seed.a.slug)).status).toBe(200);
    expect((await bulkNotifications(req('POST', { ids: mine, action: 'unarchive' }), seed.a.slug)).status).toBe(200);
    expect((await bulkNotifications(req('POST', { ids: [], action: 'read' }), seed.a.slug)).status).toBe(422);
    expect((await bulkNotifications(req('POST', { ids: mine, action: 'zap' }), seed.a.slug)).status).toBe(422);
    expect((await bulkNotifications(req('POST', { ids: mine, action: 'read', extra: 1 }), seed.a.slug)).status).toBe(422);
    as(seed.a.admin); // someone else's ids are not_found
    const other = (await (await bulkNotifications(req('POST', { ids: mine, action: 'read' }), seed.a.slug)).json()) as { updated: number };
    expect(other.updated).toBe(0);
    const l = (await (await listNotifications(req('GET'), seed.a.slug)).json()) as { items: { coalesced_count: number; meta: object; last_event_at: string }[] };
    expect(l.items.every((x) => x.coalesced_count >= 1 && typeof x.last_event_at === 'string')).toBe(true);
  });
  it('realtime: notification events are per-user with unread_count; new entities; parent roll-up; replay', async () => {
    const feed = async (u: string, after?: string) => { as(u); return (await (await getFeed(new Request(`http://x/api${after ? `?after=${after}` : ''}`), seed.a.slug)).json()) as { events: { entity: string; entity_id: string; op: string; issue_id: string | null; scope?: string; unread_count?: number; version: number }[]; cursor: string; resync: boolean }; };
    const m0 = await feed(seed.a.member), a0 = await feed(seed.a.admin);
    as(seed.a.admin);
    const parent = await mk({ assignee_id: seed.a.member });
    const child = await mk({ parent_id: parent.id });
    await withWorkspace(app, seed.a.id, async (tx) => {
      const ctx = { tx, userId: seed.a.admin, workspaceId: seed.a.id, role: 'admin' } as never;
      const id = randomUUID();
      await emitSync(ctx, { entity: 'project', id, op: 'update', version: 3 });
      await emitSync(ctx, { entity: 'view_state', id, op: 'update', userId: seed.a.admin, scope: 'view:abc' });
    }, seed.a.admin);
    const m1 = await feed(seed.a.member, m0.cursor), a1 = await feed(seed.a.admin, a0.cursor);
    const notif = m1.events.filter((e) => e.entity === 'notification');
    expect(notif.length).toBeGreaterThan(0);
    expect(notif.every((e) => typeof e.unread_count === 'number' && e.unread_count >= 1)).toBe(true);
    expect(a1.events.some((e) => e.entity === 'notification')).toBe(false); // the member's notifications never reach the admin
    expect(m1.events.some((e) => e.entity === 'project' && e.issue_id === null && e.version === 3)).toBe(true);
    expect(m1.events.some((e) => e.entity === 'view_state')).toBe(false); // per-user event of another user
    expect(a1.events.find((e) => e.entity === 'view_state')!.scope).toBe('view:abc');
    // parent roll-up: update event for the parent when the child is created
    expect(m1.events.filter((e) => e.entity === 'issue' && e.entity_id === parent.id && e.op === 'update').length).toBeGreaterThan(0);
    expect(m1.events.some((e) => e.entity === 'issue' && e.entity_id === child.id && e.op === 'create')).toBe(true);
    // guest: no workspace-wide, no per-user events of others
    const g = await feed(seed.a.guest);
    expect(g.events).toEqual([]);
    // replay: reading again from the old cursor returns the same events; a fresh cursor returns nothing new
    const again = await feed(seed.a.member, m0.cursor);
    expect(again.events.length).toBe(m1.events.length);
    expect((await feed(seed.a.member, m1.cursor)).events).toEqual([]);
    // state changes (bulk read) emit an update event to the same user only
    as(seed.a.member);
    const ids = (await inbox(seed.a.member)).map((x) => x.id).slice(0, 2);
    await bulkNotifications(req('POST', { ids, action: 'read' }), seed.a.slug);
    const m2 = await feed(seed.a.member, m1.cursor);
    expect(m2.events.filter((e) => e.entity === 'notification' && e.op === 'update').length).toBe(2);
  });
  it('due-soon cron: 503 when CRON_SECRET unset, 401 wrong/missing, creates once per due date, skips done issues', async () => {
    const call = (h?: string) => dueSoon(new Request('http://x/api/internal/notifications/due-soon', { method: 'POST', headers: h ? { 'x-cron-secret': h } : {} }));
    expect((await call('s3cret')).status).toBe(503);
    process.env.CRON_SECRET = 's3cret';
    expect((await call()).status).toBe(401);
    expect((await call('wrong')).status).toBe(401);
    as(seed.a.admin);
    const today = new Date().toISOString().slice(0, 10);
    const i = await mk({ assignee_id: seed.a.member, due_date: today });
    const done = await mk({ assignee_id: seed.a.member, due_date: today, status: 'done' });
    const r1 = (await (await call('s3cret')).json()) as { created: number };
    expect(r1.created).toBeGreaterThanOrEqual(1);
    expect(await types(seed.a.member, i.id)).toEqual(['assigned', 'due_soon']);
    expect(await types(seed.a.member, done.id)).toEqual(['assigned']);
    const n = (await inbox(seed.a.member)).find((x) => x.issue_id === i.id && x.type === 'due_soon')!;
    expect(n.meta).toEqual({ due_date: today });
    const r2 = (await (await call('s3cret')).json()) as { created: number };
    expect(r2.created).toBe(0); // idempotent
    expect((await types(seed.a.member, i.id)).filter((t) => t === 'due_soon').length).toBe(1);
  });
  it('due-soon cron: an unread due_soon with an OLD date is updated when the date changes, and other candidates still run', async () => {
    process.env.CRON_SECRET = 's3cret';
    const call = () => dueSoon(new Request('http://x/api/internal/notifications/due-soon', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } }));
    as(seed.a.admin);
    const d1 = new Date(Date.now() + 86400000).toISOString().slice(0, 10), d0 = new Date().toISOString().slice(0, 10);
    const poisoned = await mk({ assignee_id: seed.a.member, due_date: d1 }), other = await mk({ assignee_id: seed.a.member, due_date: d1 });
    await call();
    expect((await inbox(seed.a.member)).find((x) => x.issue_id === poisoned.id && x.type === 'due_soon')!.meta).toEqual({ due_date: d1 });
    await patch(poisoned, { due_date: d0 });
    const r = await call();
    expect(r.status).toBe(200);
    const rows = (await inbox(seed.a.member)).filter((x) => x.issue_id === poisoned.id && x.type === 'due_soon');
    expect(rows.length).toBe(1);
    expect(rows[0]!.meta).toEqual({ due_date: d0 });
    expect(((await r.json()) as { failed: number }).failed).toBe(0);
    expect((await types(seed.a.member, other.id)).filter((t) => t === 'due_soon').length).toBe(1);
  });
  it('sync_publish_ws cannot write another workspace (tenant WITH CHECK on sync_seq and sync_events)', async () => {
    const attempt = () => withWorkspace(app, seed.a.id, (tx) => tx`select sync_publish_ws(${seed.b.id}::uuid, ${seed.a.admin}::uuid, 'project', ${randomUUID()}::uuid, null, 'update', 1, null, null)`, seed.a.admin);
    await expect(attempt()).rejects.toThrow(/row-level security/);
    const leaked = await owner`select 1 from sync_events where workspace_id = ${seed.b.id} and entity = 'project'`;
    expect(leaked.length).toBe(0);
  });
});
