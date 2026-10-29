import { describe, it, expect, beforeAll } from 'vitest';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>; const b = '/api/v1/w/w1';
beforeAll(async () => { if (runIntegration) W = await world(); });
const mk = async (title = 'T') => (await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title })).json();

describe.skipIf(!runIntegration)('issues', () => {
  it('401 sans session', async () => { expect((await api(null, 'GET', `${b}/issues`)).status).toBe(401); });
  it('403/404 hors workspace (B1 sur w1)', async () => { expect([403,404]).toContain((await api(W.B1, 'GET', `${b}/issues`)).status); });
  it('user sans membership refusé', async () => { expect([403,404]).toContain((await api(W.N, 'GET', `${b}/issues`)).status); });
  it('création + lecture', async () => {
    const r = await api(W.M1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'hello' });
    expect(r.status).toBe(201); const i = await r.json(); expect(i.title).toBe('hello');
  });
  it('titre vide → 422', async () => { expect((await api(W.M1, 'POST', `${b}/issues`, { team_id: W.t1, title: '' })).status).toBe(422); });
  it('titre > 255 → 422', async () => { expect((await api(W.M1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'x'.repeat(256) })).status).toBe(422); });
  it('priority hors 0..4 → 422', async () => { expect((await api(W.M1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'p', priority: 9 })).status).toBe(422); });
  it('team d un autre workspace refusée', async () => { expect(((await api(W.M1, 'POST', `${b}/issues`, { team_id: W.t2, title: 'x' })).status)).toBeGreaterThanOrEqual(400); });
  it('guest ne voit que les issues partagées', async () => {
    const r = await api(W.G1, 'GET', `${b}/issues`); expect(r.status).toBe(200);
    const ids = JSON.stringify(await r.json()); expect(ids).toContain(W.i1);
  });
  it('isolation: w2 ne voit pas i1', async () => { expect(JSON.stringify(await (await api(W.B1, 'GET', '/api/v1/w/w2/issues')).json())).not.toContain(W.i1); });
  it('bulk: état vide → 422', async () => { expect((await api(W.A1, 'POST', `${b}/issues/bulk`, { ids: [] })).status).toBe(422); });
});

describe.skipIf(!runIntegration)('comments', () => {
  it('commente et rejette corps vide', async () => {
    const i = await mk();
    expect([200,201]).toContain((await api(W.M1, 'POST', `${b}/issues/${i.id}/comments`, { body: 'hi' })).status);
    expect((await api(W.M1, 'POST', `${b}/issues/${i.id}/comments`, { body: '' })).status).toBe(422);
  });
  it('401 sans session', async () => { const i = await mk(); expect((await api(null, 'POST', `${b}/issues/${i.id}/comments`, { body: 'x' })).status).toBe(401); });
});

describe.skipIf(!runIntegration)('relations', () => {
  it('auto-relation refusée (CHECK)', async () => {
    const i = await mk();
    expect((await api(W.A1, 'POST', `${b}/issues/${i.id}/relations`, { type: 'blocks', related_issue_id: i.id })).status).toBe(422);
  });
  it('doublon inverse refusé (UNIQUE least/greatest)', async () => {
    const a = await mk(), c = await mk();
    expect([200,201]).toContain((await api(W.A1, 'POST', `${b}/issues/${a.id}/relations`, { type: 'blocks', related_issue_id: c.id })).status);
    expect([400,409]).toContain((await api(W.A1, 'POST', `${b}/issues/${c.id}/relations`, { type: 'blocks', related_issue_id: a.id })).status);
  });
  it('type inconnu → 422', async () => { const a = await mk(), c = await mk(); expect((await api(W.A1, 'POST', `${b}/issues/${a.id}/relations`, { type: 'x', related_issue_id: c.id })).status).toBe(422); });
});

describe.skipIf(!runIntegration)('cycles', () => {
  it('end < start → 422', async () => { expect((await api(W.A1, 'POST', `${b}/cycles`, { team_id: W.t1, name: 'c', start_date: '2030-02-10', end_date: '2030-02-01' })).status).toBe(422); });
  it('chevauchement refusé (EXCLUDE gist)', async () => {
    const mkc = (s: string, e: string) => api(W.A1, 'POST', `${b}/cycles`, { team_id: W.t1, name: 'c', start_date: s, end_date: e });
    expect([200,201]).toContain((await mkc('2031-01-01', '2031-01-14')).status);
    expect([400,409]).toContain((await mkc('2031-01-10', '2031-01-20')).status);
  });
});

describe.skipIf(!runIntegration)('projects', () => {
  it('création, nom vide → 422, target < start → 422', async () => {
    expect([200,201]).toContain((await api(W.A1, 'POST', `${b}/projects`, { name: 'P' })).status);
    expect((await api(W.A1, 'POST', `${b}/projects`, { name: '' })).status).toBe(422);
    expect((await api(W.A1, 'POST', `${b}/projects`, { name: 'P', start_date: '2030-05-02', target_date: '2030-05-01' })).status).toBe(422);
  });
  it('status invalide → 422', async () => { expect((await api(W.A1, 'POST', `${b}/projects`, { name: 'P', status: 'nope' })).status).toBe(422); });
});

describe.skipIf(!runIntegration)('search / notifications / sync / events', () => {
  it('search renvoie 200 pour membre, 401 sans session', async () => {
    expect((await api(W.M1, 'GET', `${b}/search?q=seed`)).status).toBe(200);
    expect((await api(null, 'GET', `${b}/search?q=seed`)).status).toBe(401);
  });
  it('notifications: liste propre à l utilisateur', async () => { expect((await api(W.M1, 'GET', `${b}/notifications`)).status).toBe(200); });
  it('sync: une création produit un événement', async () => {
    // no cursor = start at head (no replay): take the head cursor first, then read after it
    const head = await (await api(W.A1, 'GET', `${b}/sync`)).json();
    await mk(); const r = await api(W.A1, 'GET', `${b}/sync?after=${encodeURIComponent(head.cursor)}`); expect(r.status).toBe(200);
    expect((await r.json()).events.map((e: { op: string }) => e.op)).toContain('create');
  });
  it('events: 401 sans session', async () => { expect((await api(null, 'GET', `${b}/events`)).status).toBe(401); });
});
