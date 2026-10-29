import pg from 'pg';
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
  // Contract: partial batch, 200 + per-id result. A foreign id is reported not_found (no existence leak) and left untouched.
  it('ids d un autre workspace: not_found par id, valeur inchangée en base', async () => {
    const dbPriority = async (id: string) => {
      const url = process.env.PGSUPER_URL ?? process.env.DATABASE_OWNER_URL;
      if (!url) throw new Error('PGSUPER_URL or DATABASE_OWNER_URL is required'); // never fall back to PG* defaults
      const p = new pg.Pool({ connectionString: url, max: 1 });
      try { return (await p.query('select priority from issues where id = $1', [id])).rows[0]?.priority as number; } finally { await p.end(); }
    };
    const before = await dbPriority(W.i2);
    expect(before).toBeTypeOf('number');
    const target = before === 4 ? 3 : 4; // sentinel != current value
    const mine = await mk();
    const r = await api(W.A1, 'POST', `${b}/issues/bulk`, { ids: [mine.id, W.i2], patch: { priority: target } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.succeeded).toEqual([mine.id]);
    expect(j.failed).toEqual([expect.objectContaining({ id: W.i2, code: 'not_found' })]);
    expect(await dbPriority(W.i2)).toBe(before);
    expect(await dbPriority(mine.id)).toBe(target);
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
  const handle = () => W.M1.email.split('@')[0];
  const count = async (id: string) => {
    const j = await (await api(W.M1, 'GET', `${b}/notifications`)).json();
    return (Array.isArray(j) ? j : j.items ?? []).filter((n: unknown) => JSON.stringify(n).includes(id)).length;
  };
  it('une mention crée exactement une notification', async () => {
    const i = await mk();
    expect(await count(i.id)).toBe(0);
    await api(W.A1, 'POST', `${b}/issues/${i.id}/comments`, { body: `ping @${handle()} merci` });
    expect(await count(i.id)).toBe(1);
  });
  it('deux mentions du même user dans un commentaire: toujours 1 notification', async () => {
    const i = await mk();
    await api(W.A1, 'POST', `${b}/issues/${i.id}/comments`, { body: `@${handle()} @${handle()}` });
    expect(await count(i.id)).toBe(1);
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
