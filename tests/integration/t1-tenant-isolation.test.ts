import { describe, it, expect, beforeAll } from 'vitest';
import { appPool, ownerPool, api, world } from './helpers/world';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { W = await world(); });

describe('T1 raw SQL as app_user', () => {
  it('no setting -> 0 rows', async () => {
    const r = await appPool.query('select count(*)::int n from issues');
    expect(r.rows[0].n).toBe(0);
  });
  it('W2 set -> 0 W1 rows', async () => {
    const c = await appPool.connect();
    try {
      await c.query('select set_config($1,$2,false)', ['app.workspace_id', W.w2]);
      expect((await c.query('select count(*)::int n from issues where workspace_id=$1', [W.w1])).rows[0].n).toBe(0);
    } finally { c.release(); }
  });
  it('INSERT with a W1 id while W2 is set is rejected by WITH CHECK', async () => {
    const c = await appPool.connect();
    try {
      await c.query('select set_config($1,$2,false)', ['app.workspace_id', W.w2]);
      await expect(c.query(`insert into labels (workspace_id, name) values ($1,'x')`, [W.w1])).rejects.toThrow(/row-level security/i);
    } finally { c.release(); }
  });
  it('pooled connection reused W1 then W2 sees no W1 data', async () => {
    const pool = new (appPool.constructor as any)({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
    try {
      await pool.query('select set_config($1,$2,false)', ['app.workspace_id', W.w1]);
      await pool.query('select set_config($1,$2,false)', ['app.workspace_id', W.w2]);
      expect((await pool.query('select count(*)::int n from issues where workspace_id=$1', [W.w1])).rows[0].n).toBe(0);
    } finally { await pool.end(); }
  });
  it('app code path: request as W1 user then B1 on the same server sees no W1 data', async () => {
    await api(W.A1, 'GET', '/api/v1/issues');
    const r = await api(W.B1, 'GET', '/api/v1/issues');
    expect(JSON.stringify(await r.json())).not.toContain(W.w1);
  });
});

describe('T1 forged workspace_id / slug', () => {
  it('body', async () => expect((await api(W.B1, 'POST', '/api/v1/issues', { title: 'x', workspace_id: W.w1 })).status).toBe(404));
  it('query', async () => expect((await api(W.B1, 'GET', `/api/v1/issues?workspace_id=${W.w1}`)).status).toBe(404));
  it('header', async () => expect((await api(W.B1, 'GET', '/api/v1/issues', undefined, { 'x-workspace-id': W.w1 })).status).toBe(404));
  it('W1 slug', async () => expect((await api(W.B1, 'GET', '/api/v1/w/w1/issues')).status).toBe(404));
});

describe('T1 cross-tenant references write nothing', () => {
  it.each([['label_ids', 'label'], ['project_id', 'project'], ['team_id', 'team'], ['parent_id', 'issue']])(
    'W1 %s used by B1 -> 404/422 and nothing written', async (field, kind) => {
      const ref = (await ownerPool.query(`select id from ${kind}s where workspace_id=$1 limit 1`, [W.w1])).rows[0].id;
      const before = (await ownerPool.query('select count(*)::int n from issues where workspace_id=$1', [W.w2])).rows[0].n;
      const r = await api(W.B1, 'POST', '/api/v1/issues', { title: 'x', [field]: field === 'label_ids' ? [ref] : ref });
      expect([404, 422]).toContain(r.status);
      const after = (await ownerPool.query('select count(*)::int n from issues where workspace_id=$1', [W.w2])).rows[0].n;
      expect(after).toBe(before);
    });
});

describe('T1 SSE and tampered cursors', () => {
  it('B1 SSE with a W1 since id -> 404 or 400', async () => {
    const r = await api(W.B1, 'GET', '/api/v1/sync?since=1');
    expect([200, 400, 404]).toContain(r.status);
    if (r.status === 200) {
      const t = await Promise.race([r.body!.getReader().read(), new Promise((res) => setTimeout(() => res(null), 1500))]);
      expect(JSON.stringify(t)).not.toContain(W.w1);
    }
  });
  it('W1 cursor used in W2 -> 400', async () => {
    const p1 = await (await api(W.A1, 'GET', '/api/v1/issues?limit=1')).json();
    const cur = p1.next_cursor; expect(cur).toBeTruthy();
    expect((await api(W.B1, 'GET', `/api/v1/issues?cursor=${cur}`)).status).toBe(400);
  });
});
