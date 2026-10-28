import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P = '/api/v1/w/w1';
const T = (team: string) => `${P}/teams/${team}/templates`;
const nm = () => 'tpl-' + Math.random().toString(36).slice(2);
const q = (v: unknown) => ({ 'If-Match': String(v) });

describe.runIf(runIntegration)('A9 issue templates', () => {
  it('admin CRUD with optimistic concurrency and duplicate-name conflict', async () => {
    const name = nm();
    const c = await api(W.A1, 'POST', T(W.t1), { name, title: 'Bug: ', description: '## Steps', priority: 2 });
    expect(c.status).toBe(201);
    const t = await c.json();
    expect((await api(W.A1, 'POST', T(W.t1), { name: name.toUpperCase() })).status).toBe(409);
    const list = await (await api(W.M1, 'GET', T(W.t1))).json();
    expect(list.items.map((x: { id: string }) => x.id)).toContain(t.id);
    expect((await api(W.A1, 'PATCH', `${T(W.t1)}/${t.id}`, { priority: 3 }, q(99))).status).toBe(412);
    const p = await api(W.A1, 'PATCH', `${T(W.t1)}/${t.id}`, { priority: 3 }, q(t.version));
    expect(p.status).toBe(200);
    expect((await p.json()).priority).toBe(3);
    expect((await api(W.A1, 'DELETE', `${T(W.t1)}/${t.id}`)).status).toBe(204);
    expect((await api(W.A1, 'GET', `${T(W.t1)}/${t.id}`)).status).toBe(404);
  });
  it('members read but cannot write; guests and non-team members see nothing', async () => {
    expect([403, 404]).toContain((await api(W.M1, 'POST', T(W.t1), { name: nm() })).status);
    expect([403, 404]).toContain((await api(W.G1, 'GET', T(W.t1))).status);
    expect((await api(W.M1, 'GET', T(W.t2w1))).status).toBe(404);
  });
  it('cross-tenant and unknown teams are 404, not 500', async () => {
    expect((await api(W.A1, 'GET', T(W.t2))).status).toBe(404);
    expect((await api(W.A1, 'POST', T(randomUUID()), { name: nm() })).status).toBe(404);
  });
  it('rejects unknown labels and bad fields', async () => {
    expect((await api(W.A1, 'POST', T(W.t1), { name: nm(), label_ids: [randomUUID()] })).status).toBe(422);
    for (const b of [{ name: '' }, { name: nm(), priority: 9 }, { name: nm(), extra: 1 }]) expect((await api(W.A1, 'POST', T(W.t1), b)).status).toBeGreaterThanOrEqual(400);
  });
  it('createIssue applies the template; explicit fields win; wrong-team template rejected', async () => {
    const t = await (await api(W.A1, 'POST', T(W.t1), { name: nm(), title: 'From template', description: 'tpl body', priority: 2 })).json();
    const a = await api(W.M1, 'POST', `${P}/issues`, { team_id: W.t1, template_id: t.id });
    expect(a.status).toBe(201);
    expect(await a.json()).toMatchObject({ title: 'From template', description: 'tpl body', priority: 2 });
    const b = await (await api(W.M1, 'POST', `${P}/issues`, { team_id: W.t1, template_id: t.id, title: 'Mine', priority: 1 })).json();
    expect(b).toMatchObject({ title: 'Mine', description: 'tpl body', priority: 1 });
    expect((await api(W.A1, 'POST', `${P}/issues`, { team_id: W.t2w1, template_id: t.id })).status).toBe(422);
    expect((await api(W.M1, 'POST', `${P}/issues`, { team_id: W.t1 })).status).toBe(422);
  });
});
