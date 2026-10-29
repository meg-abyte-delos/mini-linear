import { describe, it, expect, beforeAll } from 'vitest';
import { api, world, type U } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>; const b = '/api/v1/w/w1';
beforeAll(async () => { if (runIntegration) W = await world(); });
type Notif = { id: string } & Record<string, unknown>;
const handle = () => W.M1.email.split('@')[0];
const list = async (s: U): Promise<Notif[]> => { const j = await (await api(s, 'GET', `${b}/notifications`)).json(); return Array.isArray(j) ? j : j.items ?? []; };
// crée explicitement une notification pour M1 via mention, échoue si absente
const notifForM1 = async (): Promise<Notif> => {
  const i = await (await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'notif src' })).json();
  await api(W.A1, 'POST', `${b}/issues/${i.id}/comments`, { body: `salut @${handle()}` });
  const n = (await list(W.M1)).find((x) => JSON.stringify(x).includes(i.id));
  expect(n, 'notification M1 non créée par la mention').toBeTruthy();
  return n as Notif;
};

describe.skipIf(!runIntegration)('snooze / archive (notification créée explicitement)', () => {
  it('snooze futur OK, passé → 422', async () => {
    const n = await notifForM1();
    const fut = new Date(Date.now() + 86400000).toISOString();
    expect([200, 204]).toContain((await api(W.M1, 'POST', `${b}/notifications/${n.id}/snooze`, { until: fut })).status);
    expect((await api(W.M1, 'POST', `${b}/notifications/${n.id}/snooze`, { until: '2000-01-01T00:00:00Z' })).status).toBe(422);
  });
  it('snoozée absente de la liste par défaut', async () => {
    const n = await notifForM1();
    await api(W.M1, 'POST', `${b}/notifications/${n.id}/snooze`, { until: new Date(Date.now() + 86400000).toISOString() });
    expect(JSON.stringify(await list(W.M1))).not.toContain(n.id);
  });
  it('archive retire de la liste, autre user → 403/404', async () => {
    const n = await notifForM1();
    expect([403, 404]).toContain((await api(W.M2, 'POST', `${b}/notifications/${n.id}/archive`, {})).status);
    expect([200, 204]).toContain((await api(W.M1, 'POST', `${b}/notifications/${n.id}/archive`, {})).status);
    expect(JSON.stringify(await list(W.M1))).not.toContain(n.id);
  });
  it('archive idempotent (2e appel pas 5xx)', async () => {
    const n = await notifForM1();
    await api(W.M1, 'POST', `${b}/notifications/${n.id}/archive`, {});
    expect((await api(W.M1, 'POST', `${b}/notifications/${n.id}/archive`, {})).status).toBeLessThan(500);
  });
});

describe.skipIf(!runIntegration)('If-Match / concurrence', () => {
  it('sans If-Match → 428, courant → 200, périmé → 412', async () => {
    const i = await (await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'cc' })).json();
    expect((await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'a' })).status).toBe(428);
    expect((await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'a' }, { 'If-Match': `"${i.version}"` })).status).toBe(200);
    expect((await api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'b' }, { 'If-Match': `"${i.version}"` })).status).toBe(412);
  });
  it('deux PATCH concurrents sur la même version: un seul gagne', async () => {
    const i = await (await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'race' })).json();
    const h = { 'If-Match': `"${i.version}"` };
    const r = await Promise.all([api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'x' }, h), api(W.A1, 'PATCH', `${b}/issues/${i.id}`, { title: 'y' }, h)]);
    expect(r.map(x => x.status).sort()).toEqual([200, 412]);
  });
});

describe.skipIf(!runIntegration)('sync ?after=', () => {
  it('curseur de tête, création, puis événement après le curseur', async () => {
    const head = await (await api(W.A1, 'GET', `${b}/sync`)).json();
    await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'sync3' });
    const r = await (await api(W.A1, 'GET', `${b}/sync?after=${head.cursor}`)).json();
    expect(r.events.some((e: { op: string }) => e.op === 'create')).toBe(true);
    const again = await (await api(W.A1, 'GET', `${b}/sync?after=${r.cursor}`)).json();
    expect(again.events).toEqual([]);
  });
  it('B1 ne voit pas les événements de w1', async () => {
    const head = await (await api(W.A1, 'GET', `${b}/sync`)).json();
    await api(W.A1, 'POST', `${b}/issues`, { team_id: W.t1, title: 'iso3' });
    expect([403, 404]).toContain((await api(W.B1, 'GET', `${b}/sync?after=${head.cursor}`)).status);
  });
});
