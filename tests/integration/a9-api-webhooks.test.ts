// Area 9 / Part 5: personal API keys, public REST API auth, outbound webhooks (black-box, running app + DB).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { inWs, api, world, appPool } from './helpers/world';
import { runIntegration } from './helpers/gate';
import { verify } from '../../src/lib/integrations/webhooks';

let W: Awaited<ReturnType<typeof world>>;
const P1 = '/api/v1/w/w1', P2 = '/api/v1/w/w2';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const mkKey = async (u: typeof W.M1, scope: 'read' | 'write' = 'write') => {
  const r = await api(u, 'POST', `${P1}/api-keys`, { name: `k-${scope}`, scope });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string; token: string; prefix: string };
};

const got: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let srv: Server, port = 0;
beforeAll(async () => {
  if (!runIntegration) return;
  W = await world();
  srv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ headers: req.headers, body: b }); res.end('ok'); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  port = (srv.address() as { port: number }).port;
});
afterAll(() => srv?.close());

describe.runIf(runIntegration)('A9 API keys', () => {
  it('token shown once, only the hash stored, listing hides it', async () => {
    const k = await mkKey(W.M1);
    expect(k.token).toMatch(/^mlk_[a-z0-9]{8}_/);
    const row = (await inWs(W.w1, (c) => c.query('select key_hash, prefix from api_keys where id=$1', [k.id]))).rows[0];
    expect(row.key_hash).not.toContain(k.token);
    expect(row.prefix).toBe(k.prefix);
    const l = await (await api(W.M1, 'GET', `${P1}/api-keys`)).json();
    expect(JSON.stringify(l)).not.toContain(k.token);
    expect(l.items.some((x: { id: string }) => x.id === k.id)).toBe(true);
  });
  it('key acts as its owner: CRUD in own team, team scoping kept, other workspace 404', async () => {
    const k = await mkKey(W.M1);
    const c = await api(null, 'POST', `${P1}/issues`, { title: 'via key', team_id: W.t1 }, bearer(k.token));
    expect(c.status).toBe(201);
    const id = (await c.json()).id;
    expect((await api(null, 'GET', `${P1}/issues/${id}`, undefined, bearer(k.token))).status).toBe(200);
    const page = await (await api(null, 'GET', `${P1}/issues?limit=1`, undefined, bearer(k.token))).json();
    expect(page.items).toHaveLength(1);
    expect(page).toHaveProperty('next_cursor');
    const k2 = await mkKey(W.M2); // M2 is not in T1
    expect((await api(null, 'GET', `${P1}/issues/${id}`, undefined, bearer(k2.token))).status).toBe(404);
    expect((await api(null, 'GET', `${P2}/issues`, undefined, bearer(k.token))).status).toBe(404);
  });
  it('read scope refuses writes; keys cannot manage keys or webhooks', async () => {
    const r = await mkKey(W.M1, 'read');
    expect((await api(null, 'GET', `${P1}/issues`, undefined, bearer(r.token))).status).toBe(200);
    expect((await api(null, 'POST', `${P1}/issues`, { title: 'x', team_id: W.t1 }, bearer(r.token))).status).toBe(403);
    const a = await (await api(W.A1, 'POST', `${P1}/api-keys`, { name: 'admin' })).json();
    expect((await api(null, 'POST', `${P1}/api-keys`, { name: 'mint' }, bearer(a.token))).status).toBe(403);
    expect((await api(null, 'GET', `${P1}/webhooks`, undefined, bearer(a.token))).status).toBe(403);
  });
  it('revoked, malformed and unknown keys -> 401; members cannot revoke others', async () => {
    const k = await mkKey(W.M1);
    expect((await api(W.M2, 'DELETE', `${P1}/api-keys/${k.id}`)).status).toBe(404);
    expect((await api(W.M1, 'DELETE', `${P1}/api-keys/${k.id}`)).status).toBe(204);
    expect((await api(null, 'GET', `${P1}/issues`, undefined, bearer(k.token))).status).toBe(401);
    expect((await api(null, 'GET', `${P1}/issues`, undefined, bearer('nope'))).status).toBe(401);
    expect((await api(null, 'GET', `${P1}/issues`, undefined, bearer(`mlk_abcdefgh_${'A'.repeat(43)}`))).status).toBe(401);
  });
});

describe.runIf(runIntegration)('A9 webhooks', () => {
  it('admin only; secret returned once; bad urls/events 422', async () => {
    expect((await api(W.M1, 'POST', `${P1}/webhooks`, { url: 'https://example.com/h', events: ['issue.created'] })).status).toBe(403);
    const c = await api(W.A1, 'POST', `${P1}/webhooks`, { url: 'https://example.com/h', events: ['issue.created'] });
    expect(c.status).toBe(201);
    const h = await c.json();
    expect(h.secret).toMatch(/^whsec_/);
    const g = await (await api(W.A1, 'GET', `${P1}/webhooks/${h.id}`)).json();
    expect(g.secret).toBeUndefined();
    expect((await api(W.A1, 'POST', `${P1}/webhooks`, { url: 'ftp://x', events: ['issue.created'] })).status).toBe(422);
    expect((await api(W.A1, 'POST', `${P1}/webhooks`, { url: 'https://example.com', events: ['nope'] })).status).toBe(422);
    expect((await api(W.A1, 'DELETE', `${P1}/webhooks/${h.id}`)).status).toBe(204);
  });
  it('issue change is enqueued in the same tx, delivered signed, logged', async () => {
    // Inserted as owner: the API refuses loopback URLs in production builds (SSRF guard).
    const hid = randomUUID(), secret = 'whsec_test_' + hid;
    await inWs(W.w1, (c) => c.query('insert into webhooks (id, workspace_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5,$6)',
      [hid, W.w1, `http://127.0.0.1:${port}/hook`, secret, ['issue.created', 'comment.created'], W.A1id]));
    const k = await mkKey(W.M1);
    const r = await api(null, 'POST', `${P1}/issues`, { title: 'hooked', team_id: W.t1 }, bearer(k.token));
    const issueId = (await r.json()).id;
    const q = await inWs(W.w1, (c) => c.query('select event, payload from webhook_deliveries where webhook_id=$1', [hid]));
    expect(q.rows.map((x) => x.event)).toEqual(['issue.created']);
    expect(q.rows[0].payload.data.id).toBe(issueId);
    for (let i = 0; i < 40 && !got.some((g) => g.body.includes(issueId)); i++) await new Promise((s) => setTimeout(s, 500));
    const d = got.find((g) => g.body.includes(issueId));
    expect(d, 'delivery received').toBeTruthy();
    expect(d!.headers['x-minilinear-event']).toBe('issue.created');
    expect(verify(secret, d!.body, String(d!.headers['x-minilinear-signature']))).toBe(true);
    const log = await (await api(W.A1, 'GET', `${P1}/webhooks/${hid}/deliveries`)).json();
    expect(log.items[0].event).toBe('issue.created');
  }, 30_000);
  it('other workspaces never see the webhook or its deliveries', async () => {
    const l = await (await api(W.B1, 'GET', `${P2}/webhooks`)).json().catch(() => ({ items: [] }));
    expect(l.items ?? []).toEqual([]);
  });
});


describe.runIf(runIntegration)('A9 rework: key scope, invalid-key rate limit, header handling', () => {
  it('read/write keys act as at most member; an admin-scope key keeps admin powers; only admins mint admin keys', async () => {
    const w = await (await api(W.A1, 'POST', `${P1}/api-keys`, { name: 'adm-write', scope: 'write' })).json();
    expect((await api(null, 'GET', `${P1}/audit`, undefined, bearer(w.token))).status).toBe(403);
    const a = await api(W.A1, 'POST', `${P1}/api-keys`, { name: 'adm', scope: 'admin' });
    expect(a.status).toBe(201);
    expect((await api(null, 'GET', `${P1}/audit`, undefined, bearer((await a.json()).token))).status).toBe(200);
    expect((await api(W.M1, 'POST', `${P1}/api-keys`, { name: 'x', scope: 'admin' })).status).toBe(403);
  });
  it('non-Bearer / empty Authorization is 401, never the cookie session', async () => {
    for (const h of ['Basic abc', 'Token abc', 'Bearer', '']) {
      const r = await api(W.M1, 'GET', `${P1}/issues`, undefined, { authorization: h });
      expect(r.status, `Authorization: "${h}"`).toBe(401);
    }
  });
  it('invalid keys are rate limited (429) per client', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await api(null, 'GET', `${P1}/issues`, undefined, bearer(`mlk_abcdefgh_${'B'.repeat(43)}`), process.env.TEST_BASE_URL_2 ?? undefined)).status);
    expect(codes[0]).toBe(401);
    expect(codes).toContain(429);
  }, 30_000);
});

describe.runIf(runIntegration)('A9 rework: webhook secrets and dispatcher role', () => {
  const asApp = async <T,>(f: (c: import('pg').PoolClient) => Promise<T>) => { const c = await appPool.connect(); try { return await f(c); } finally { c.release(); } };
  it('app_user cannot read webhooks.secret (column grants) nor run the dispatcher functions', async () => {
    await expect(asApp((c) => c.query('select secret from webhooks'))).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query('select * from webhooks'))).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query('select * from claim_webhook_deliveries(10)'))).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query("select complete_webhook_delivery(gen_random_uuid(), gen_random_uuid(), true, 200, null)"))).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query('select purge_webhook_deliveries(1)'))).rejects.toThrow(/permission denied/);
    await expect(asApp((c) => c.query('update webhooks set secret = $1', ['x']))).rejects.toThrow(/permission denied/);
  });
  it('complete_webhook_delivery checks the tenant: another workspace id is a no-op', async () => {
    const hid = randomUUID(), did = randomUUID();
    await inWs(W.w1, async (c) => {
      await c.query('insert into webhooks (id, workspace_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5,$6)', [hid, W.w1, 'https://example.com/x', 'whsec_t', ['issue.created'], W.A1id]);
      await c.query("insert into webhook_deliveries (id, workspace_id, webhook_id, event, payload, attempts) values ($1,$2,$3,'issue.created','{}',1)", [did, W.w1, hid]);
    });
    const c = await appPool.connect();
    try {
      await c.query('begin'); await c.query('set local role webhook_dispatcher');
      await c.query('select complete_webhook_delivery($1,$2,true,200,null)', [did, W.w2]); // wrong tenant
      await c.query('commit');
    } finally { c.release(); }
    const st = (await inWs(W.w1, (x) => x.query('select status from webhook_deliveries where id=$1', [did]))).rows[0].status;
    expect(st).toBe('pending');
    const c2 = await appPool.connect();
    try {
      await c2.query('begin'); await c2.query('set local role webhook_dispatcher');
      await c2.query('select complete_webhook_delivery($1,$2,true,200,null)', [did, W.w1]);
      await c2.query('commit');
    } finally { c2.release(); }
    expect((await inWs(W.w1, (x) => x.query('select status from webhook_deliveries where id=$1', [did]))).rows[0].status).toBe('succeeded');
  });
  it('retention deletes finished deliveries older than the window, keeps pending and recent ones', async () => {
    const hid = randomUUID();
    const ids = { old: randomUUID(), recent: randomUUID(), pend: randomUUID() };
    await inWs(W.w1, async (c) => {
      await c.query('insert into webhooks (id, workspace_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5,$6)', [hid, W.w1, 'https://example.com/y', 'whsec_t', ['issue.created'], W.A1id]);
      await c.query("insert into webhook_deliveries (id, workspace_id, webhook_id, event, payload, status, created_at) values ($1,$4,$5,'issue.created','{}','succeeded', now() - interval '90 days'), ($2,$4,$5,'issue.created','{}','succeeded', now()), ($3,$4,$5,'issue.created','{}','pending', now() - interval '90 days')", [ids.old, ids.recent, ids.pend, W.w1, hid]);
    });
    const c = await appPool.connect();
    try { await c.query('begin'); await c.query('set local role webhook_dispatcher'); await c.query('select purge_webhook_deliveries(30)'); await c.query('commit'); } finally { c.release(); }
    const left = (await inWs(W.w1, (x) => x.query('select id from webhook_deliveries where webhook_id=$1', [hid]))).rows.map((r) => r.id);
    expect(left.sort()).toEqual([ids.recent, ids.pend].sort());
  });
  it('payload omits the internal tsv column', async () => {
    const k = await mkKey(W.M1);
    const hid = randomUUID();
    await inWs(W.w1, (c) => c.query('insert into webhooks (id, workspace_id, url, secret, events, created_by) values ($1,$2,$3,$4,$5,$6)', [hid, W.w1, 'https://example.com/z', 'whsec_t', ['issue.created'], W.A1id]));
    await api(null, 'POST', `${P1}/issues`, { title: 'payload', team_id: W.t1 }, bearer(k.token));
    const p = (await inWs(W.w1, (c) => c.query('select payload from webhook_deliveries where webhook_id=$1', [hid]))).rows[0].payload;
    expect(p.data.title).toBe('payload');
    expect(p.data).not.toHaveProperty('tsv');
  });
});
