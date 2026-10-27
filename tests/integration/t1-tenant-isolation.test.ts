import { describe, it, expect, beforeAll } from 'vitest';
import { appPool, ownerPool, api, world } from './helpers/world';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { W = await world(); });
const P1 = '/api/v1/w/w1', P2 = '/api/v1/w/w2';

describe('T1 raw SQL as app_user', () => {
  it('no setting -> 0 rows', async () => {
    expect((await appPool.query('select count(*)::int n from issues')).rows[0].n).toBe(0);
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
  it('request as A1 on W1 then B1 on W2 sees no W1 data', async () => {
    await api(W.A1, 'GET', `${P1}/issues`);
    const r = await api(W.B1, 'GET', `${P2}/issues`);
    expect(r.status).toBe(200);
    expect(JSON.stringify((await r.json()).items)).not.toContain(W.w1);
  });
});

describe('T1 forged workspace_id / slug', () => {
  it('body workspace_id is ignored or rejected, nothing lands in W1', async () => {
    const r = await api(W.B1, 'POST', `${P2}/issues`, { title: 'forged-body', workspace_id: W.w1, team_id: W.t2 });
    expect([201, 400, 404, 422]).toContain(r.status);
    expect((await ownerPool.query(`select count(*)::int n from issues where title='forged-body' and workspace_id=$1`, [W.w1])).rows[0].n).toBe(0);
  });
  it('query workspace_id is ignored: no W1 data', async () => {
    const r = await api(W.B1, 'GET', `${P2}/issues?workspace_id=${W.w1}`);
    expect([200, 400, 404]).toContain(r.status);
    expect(await r.text()).not.toContain(W.w1);
  });
  it('header x-workspace-id is ignored: no W1 data', async () => {
    const r = await api(W.B1, 'GET', `${P2}/issues`, undefined, { 'x-workspace-id': W.w1 });
    expect(await r.text()).not.toContain(W.w1);
  });
  it('W1 slug as non-member -> 404', async () => expect((await api(W.B1, 'GET', `${P1}/issues`)).status).toBe(404));
});

describe('T1 cross-tenant references write nothing', () => {
  it.each([['label_ids', 'label'], ['project_id', 'project'], ['team_id', 'team'], ['parent_id', 'issue']])(
    'W1 %s used by B1 in W2 -> 404/422 and nothing written', async (field, kind) => {
      const ref = (await ownerPool.query(`select id from ${kind}s where workspace_id=$1 limit 1`, [W.w1])).rows[0].id;
      const count = async () => (await ownerPool.query('select count(*)::int n from issues where workspace_id=$1', [W.w2])).rows[0].n;
      const before = await count();
      const body: Record<string, unknown> = { title: 'x', team_id: W.t2, [field]: field === 'label_ids' ? [ref] : ref };
      const r = await api(W.B1, 'POST', `${P2}/issues`, body);
      expect([404, 422]).toContain(r.status);
      expect(await count()).toBe(before);
    });
});

describe('T1 SSE and tampered cursors', () => {
  it('B1 sync on W1 -> 404', async () => {
    expect((await api(W.B1, 'GET', `${P1}/sync?since=0`)).status).toBe(404);
  });
  it('B1 sync on W2 with a W1 since id leaks nothing', async () => {
    const r = await api(W.B1, 'GET', `${P2}/sync?since=1`);
    expect([200, 400, 404]).toContain(r.status);
    if (r.status === 200) {
      const t = await Promise.race([r.body!.getReader().read(), new Promise((res) => setTimeout(() => res(null), 1500))]);
      expect(JSON.stringify(t)).not.toContain(W.w1);
    }
  });
  it('W1 cursor used in W2 -> 400', async () => {
    const p1 = await (await api(W.A1, 'GET', `${P1}/issues?limit=1`)).json();
    const cur = p1.next_cursor; expect(cur).toBeTruthy();
    expect((await api(W.B1, 'GET', `${P2}/issues?cursor=${cur}`)).status).toBe(400);
  });
});
