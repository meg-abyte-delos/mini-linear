// Wave 0 (Tess): every mutation of an issue must leave a readable, correctly attributed row in the activity feed. Black-box HTTP, from the API contract.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, world, inWs } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
type Item = { id: string; actor_id: string; entity: string; action: string; summary: string; changes: { field: string; before: unknown; after: unknown; text: string }[] };
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);

const mk = async (extra: Record<string, unknown> = {}) => {
  const r = await api(W.M1, 'POST', `${P}/issues`, { title: 'act', team_id: W.t1, ...extra });
  expect(r.status).toBe(201);
  return { id: (await r.json()).id as string, etag: r.headers.get('etag')! };
};
const feed = async (id: string, u = W.M1, q = ''): Promise<Item[]> => {
  const r = await api(u, 'GET', `${P}/issues/${id}/activity?limit=100${q}`);
  expect(r.status).toBe(200);
  return (await r.json()).items;
};
const patch = async (id: string, etag: string, body: Record<string, unknown>, u = W.A1) => {
  const r = await api(u, 'PATCH', `${P}/issues/${id}`, body, { 'if-match': etag });
  expect(r.status, JSON.stringify(body)).toBe(200);
  return r.headers.get('etag')!;
};
const newestUpdate = (items: Item[]) => items.find((i) => i.entity === 'issue' && i.action === 'update')!;

describe.runIf(runIntegration)('activity feed: one entry per mutation', () => {
  it('create writes created the issue attributed to the creator', async () => {
    const { id } = await mk();
    const items = await feed(id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ entity: 'issue', action: 'create', summary: 'created the issue', actor_id: W.M1.id });
  });

  it.each([
    ['status', { status: 'in_progress' }, 'status', /status from Backlog to In Progress/],
    ['priority', { priority: 4 }, 'priority', /priority from No priority to /],
    ['title', { title: 'renamed' }, 'title', /title from/],
    ['assignee set', { assignee_id: 'M1' }, 'assignee_id', /set assignee to/],
    ['due date', { due_date: '2030-01-15' }, 'due_date', /due date/],
    ['estimate', { estimate: 3 }, 'estimate', /estimate/],
  ])('PATCH %s adds one update row with a before/after change, attributed to the actor', async (_n, body, field, text) => {
    const { id, etag } = await mk();
    const b = JSON.parse(JSON.stringify(body).replace('M1', W.M1.id));
    await patch(id, etag, b, W.A1);
    const items = await feed(id);
    expect(items.filter((i) => i.action === 'update')).toHaveLength(1);
    const u = newestUpdate(items);
    expect(u.actor_id).toBe(W.A1.id);
    const ch = u.changes.find((c) => c.field === field)!;
    expect(ch, JSON.stringify(u.changes)).toBeTruthy();
    expect(ch.text).toMatch(text);
    expect(u.summary).toContain(ch.text);
  });

  it('a multi-field PATCH is a single row listing every field', async () => {
    const { id, etag } = await mk();
    await patch(id, etag, { status: 'done', priority: 2 });
    const ups = (await feed(id)).filter((i) => i.action === 'update');
    expect(ups).toHaveLength(1);
    expect(ups[0]!.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['priority', 'status']));
  });

  it('clearing the assignee is recorded as cleared', async () => {
    const { id, etag } = await mk({ assignee_id: W.M1.id });
    await patch(id, etag, { assignee_id: null });
    expect(newestUpdate(await feed(id)).changes.find((c) => c.field === 'assignee_id')!.text).toMatch(/^cleared assignee/);
  });

  it('adding and removing labels is recorded with counts', async () => {
    const { id, etag } = await mk();
    const lab = (await inWs(W.w1, (c) => c.query('select id, name from labels where workspace_id = $1 limit 1', [W.w1]))).rows[0].id as string; const labName = (await inWs(W.w1, (c) => c.query('select name from labels where id = $1', [lab]))).rows[0].name as string;
    const e2 = await patch(id, etag, { label_ids: [lab] });
    expect(newestUpdate(await feed(id)).summary).toBe('added ' + labName);
    await patch(id, e2, { label_ids: [] });
    expect(newestUpdate(await feed(id)).summary).toBe('removed ' + labName);
  });

  it('a no-op PATCH (same value) does not invent a change on the field', async () => {
    const { id, etag } = await mk({ priority: 2 });
    await patch(id, etag, { priority: 2 });
    const updates = (await feed(id)).filter((i) => i.action === 'update');
    expect(updates).toHaveLength(0); // #192: no empty events, a no-op PATCH writes no update row at all
    for (const u of updates) expect(u.changes.filter((c) => c.field === 'priority' && c.before === c.after)).toEqual([]);
    // control: a real change right after produces exactly one update row
    await patch(id, (await api(W.M1, 'GET', `${P}/issues/${id}`)).headers.get('etag')!, { priority: 3 });
    expect((await feed(id)).filter((i) => i.action === 'update')).toHaveLength(1);
  });

  it('description edits are reported as updated and never quote the text', async () => {
    const { id, etag } = await mk();
    await patch(id, etag, { description: 'TOP-SECRET-BODY-123' });
    const items = await feed(id);
    expect(JSON.stringify(items)).not.toContain('TOP-SECRET-BODY-123');
    expect(newestUpdate(items).changes.find((c) => c.field === 'description')!.text).toBe('updated the description');
  });

  it('archive, unarchive, delete and restore each write their own row, in order', async () => {
    const { id } = await mk();
    expect((await api(W.M1, 'POST', `${P}/issues/${id}/archive`)).status).toBe(200);
    expect((await api(W.M1, 'POST', `${P}/issues/${id}/unarchive`)).status).toBe(200);
    const g = await api(W.M1, 'GET', `${P}/issues/${id}`);
    const del = await api(W.M1, 'DELETE', `${P}/issues/${id}`, undefined, { 'if-match': g.headers.get('etag')! });
    expect(del.status).toBe(204);
    expect((await api(W.M1, 'POST', `${P}/issues/${id}/restore`)).status).toBe(200);
    const sums = (await feed(id)).map((i) => i.summary);
    expect(sums.slice(0, 4)).toEqual(['restored the issue', 'deleted the issue', 'unarchived the issue', 'archived the issue']);
    expect(sums[sums.length - 1]).toBe('created the issue');
  });

  it('comment create / edit / delete are all in the feed without leaking bodies', async () => {
    const { id } = await mk();
    const c = await api(W.M1, 'POST', `${P}/issues/${id}/comments`, { body: 'first-body-zz' });
    expect(c.status).toBe(201);
    const cid = (await c.json()).id as string;
    const e = await api(W.M1, 'PATCH', `${P}/comments/${cid}`, { body: 'second-body-zz' }, { 'if-match': '1' });
    expect(e.status).toBe(200);
    const d = await api(W.M1, 'DELETE', `${P}/comments/${cid}`, undefined, { 'if-match': e.headers.get('etag') ?? '2' });
    expect(d.status).toBe(204);
    const items = await feed(id);
    expect(items.map((i) => i.summary)).toEqual(expect.arrayContaining(['commented', 'edited a comment', 'deleted a comment']));
    expect(JSON.stringify(items)).not.toMatch(/body-zz/);
  });

  it('bulk patch writes an activity row on every affected issue', async () => {
    const a = (await mk()).id, b = (await mk()).id;
    expect((await api(W.M1, 'POST', `${P}/issues/bulk`, { ids: [a, b], patch: { status: 'todo' } })).status).toBe(200);
    for (const id of [a, b]) {
      const u = newestUpdate(await feed(id));
      expect(u, id).toBeTruthy();
      expect(u.summary).toMatch(/status from Backlog to Todo/);
      expect(u.actor_id).toBe(W.M1.id);
    }
  });

  it('a rejected PATCH (stale ETag, validation) leaves no trace in the feed', async () => {
    const { id, etag } = await mk();
    await patch(id, etag, { priority: 1 });
    const before = (await feed(id)).length;
    expect((await api(W.M1, 'PATCH', `${P}/issues/${id}`, { priority: 3 }, { 'if-match': etag })).status).toBe(412);
    expect((await api(W.M1, 'PATCH', `${P}/issues/${id}`, { priority: 99 }, { 'if-match': '2' })).status).toBe(422);
    expect((await feed(id)).length).toBe(before);
  });

  it('feed is newest first, entity filter works, access follows the issue', async () => {
    const { id, etag } = await mk();
    await patch(id, etag, { priority: 1 });
    const items = await feed(id);
    expect(items[0]!.action).toBe('update');
    expect((await feed(id, W.M1, '&entity=issue')).every((i) => i.entity === 'issue')).toBe(true);
    expect((await api(W.B1, 'GET', `${P}/issues/${id}/activity`)).status).toBe(404);
    expect((await api(null, 'GET', `${P}/issues/${id}/activity`)).status).toBe(401);
    expect((await api(W.M1, 'GET', `${P}/issues/${id}/activity?cursor=forged`)).status).toBe(400);
    expect((await api(W.M1, 'GET', `${P}/issues/${randomUUID()}/activity`)).status).toBe(404);
    expect((await api(W.M1, 'GET', `${P}/issues/${id}/activity?limit=0`)).status).toBeGreaterThanOrEqual(400);
  });
});
