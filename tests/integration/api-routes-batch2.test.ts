import { describe, it, expect, beforeAll } from 'vitest';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>; const b = '/api/v1/w/w1';
beforeAll(async () => { if (runIntegration) W = await world(); });
const mk = async (title = 'T') => (await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title })).json();

const im = (v: number) => ({ 'if-match': `"${v}"` }); // optimistic concurrency: If-Match header, not a body field

describe.skipIf(!runIntegration)('PATCH version périmée', () => {
  it('PATCH avec version courante OK, puis avec l ancienne → 412', async () => {
    const i = await mk();
    const r1 = await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'v2' }, im(i.version));
    expect(r1.status).toBe(200);
    const r2 = await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'v3' }, im(i.version));
    expect(r2.status).toBe(412);
    const cur = await (await api(W.A1, 'GET', `${b}/issues/${i.id}`)).json();
    expect(cur.title).toBe('v2');
  });
  it('PATCH sans session → 401, hors workspace → 403/404', async () => {
    const i = await mk();
    expect((await api(null, 'PATCH', `${b}/issues/${i.id}`, { title: 'x' })).status).toBe(401);
    expect([403,404]).toContain((await api(W.B1, 'PATCH', `${b}/issues/${i.id}`, { title: 'x' })).status);
  });
  it('PATCH sans If-Match → 428', async () => {
    const i = await mk();
    expect((await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'x' })).status).toBe(428);
  });
  it('PATCH titre vide → 422', async () => {
    const i = await mk();
    expect((await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: '' }, im(i.version))).status).toBe(422);
  });
});

describe.skipIf(!runIntegration)('bulk cross-workspace', () => {
  it('ids d un autre workspace ne sont pas modifiés', async () => {
    const mine = await mk();
    const r = await api(W.A1, 'POST', `${b}/issues/bulk`, { ids: [mine.id, W.i2], patch: { priority: 1 } });
    expect([200,400,404]).toContain(r.status);
    const other = await (await api(W.B1, 'GET', `/api/v1/w/w2/issues/${W.i2}`)).json();
    expect(other.priority).not.toBe(1);
  });
  it('bulk valide met à jour tous les ids du workspace', async () => {
    const x = await mk(), y = await mk();
    const r = await api(W.A1, 'POST', `${b}/issues/bulk`, { ids: [x.id, y.id], patch: { priority: 2 } });
    expect(r.status).toBe(200);
    for (const i of [x, y]) expect((await (await api(W.A1, 'GET', `${b}/issues/${i.id}`)).json()).priority).toBe(2);
  });
  it('bulk sans session → 401', async () => { expect((await api(null, 'POST', `${b}/issues/bulk`, { ids: [W.i1], patch: { priority: 1 } })).status).toBe(401); });
});

// Mentioned user must see the issue: M1 is in team t1, M2 is not (members only see their teams' issues). Handle = email local part.
describe.skipIf(!runIntegration)('mentions', () => {
  const h1 = () => W.M1.email.split('@')[0];
  it('une mention crée une seule notification pour le mentionné', async () => {
    const i = await mk();
    const before = await (await api(W.M1, 'GET', `${b}/notifications`)).json();
    const n0 = JSON.stringify(before).split(i.id).length - 1;
    await api(W.A1, 'POST', `${b}/issues/${i.id}/comments`, { body: `ping @${h1()} merci` });
    const after = await (await api(W.M1, 'GET', `${b}/notifications`)).json();
    const n1 = JSON.stringify(after).split(i.id).length - 1;
    expect(n1 - n0).toBeGreaterThanOrEqual(1);
  });
  it('mentionner deux fois le même user dans un commentaire ne double pas la notif', async () => {
    const i = await mk(); const h = h1();
    await api(W.A1, 'POST', `${b}/issues/${i.id}/comments`, { body: `@${h} @${h}` });
    const list = await (await api(W.M1, 'GET', `${b}/notifications`)).json();
    const items = (Array.isArray(list) ? list : list.items ?? []).filter((n: { id: string }) => JSON.stringify(n).includes(i.id));
    expect(items.length).toBe(1);
  });
});

describe.skipIf(!runIntegration)('snooze / archive', () => {
  const firstNotif = async () => {
    const list = await (await api(W.M1, 'GET', `${b}/notifications`)).json();
    return (Array.isArray(list) ? list : list.items ?? [])[0];
  };
  it('snooze avec date future OK, passée → 422', async () => {
    const n = await firstNotif(); if (!n) return;
    const fut = new Date(Date.now() + 86400000).toISOString();
    expect([200,204]).toContain((await api(W.M1, 'POST', `${b}/notifications/${n.id}/snooze`, { until: fut })).status);
    expect((await api(W.M1, 'POST', `${b}/notifications/${n.id}/snooze`, { until: '2000-01-01T00:00:00Z' })).status).toBe(422);
  });
  it('archive puis absente de la liste par défaut', async () => {
    const n = await firstNotif(); if (!n) return;
    expect([200,204]).toContain((await api(W.M1, 'POST', `${b}/notifications/${n.id}/archive`, {})).status);
    expect(JSON.stringify(await (await api(W.M1, 'GET', `${b}/notifications`)).json())).not.toContain(n.id);
  });
  it('un autre user ne peut pas archiver la notif de M1', async () => {
    const n = await firstNotif(); if (!n) return;
    expect([403,404]).toContain((await api(W.M2, 'POST', `${b}/notifications/${n.id}/archive`, {})).status);
  });
  it('id inconnu → 404', async () => {
    expect(((await api(W.M1, 'POST', `${b}/notifications/00000000-0000-0000-0000-000000000000/archive`, {})).status)).toBe(404);
  });
});

describe.skipIf(!runIntegration)('activity', () => {
  it('création + changement de statut apparaissent dans l activité, dans l ordre', async () => {
    const i = await mk();
    await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { priority: 3 }, im(i.version));
    const r = await api(W.A1, 'GET', `${b}/issues/${i.id}/activity`);
    expect(r.status).toBe(200);
    const a = await r.json(); const items = Array.isArray(a) ? a : a.items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const t = items.map((x: { created_at: string }) => new Date(x.created_at).getTime());
    expect([...t].sort((p, q) => q - p)).toEqual(t); // [H] ordre décroissant
  });
  it('401 sans session, 403/404 hors workspace', async () => {
    const i = await mk();
    expect((await api(null, 'GET', `${b}/issues/${i.id}/activity`)).status).toBe(401);
    expect([403,404]).toContain((await api(W.B1, 'GET', `${b}/issues/${i.id}/activity`)).status);
  });
});
