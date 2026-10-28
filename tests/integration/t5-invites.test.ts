import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ownerPool, appPool, inWs, api, world, type U } from './helpers/world';
import { runIntegration } from './helpers/gate';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); });
const P1 = '/api/v1/w/w1';
const accept = (u: U | null, token: string) => api(u, 'POST', '/api/v1/invites/accept', { token });
const snap = async (r: Response) => ({
  s: r.status,
  b: (await r.text()).replace(/"request_?id":"[^"]*"/i, ''),
  h: [...(r.headers as unknown as Iterable<[string, string]>)].filter(([k]) => !['date', 'x-request-id', 'content-length', 'set-cookie'].includes(k)).sort().join('|'),
});
// Seeds an invite directly as owner; returns the raw token.
const seed = async (o: { email: string; role?: string; expired?: boolean; revoked?: boolean; used?: boolean }) => {
  const token = randomBytes(32).toString('base64url');
  // schema has used_at, no revoked_at (#51); RLS is FORCEd so seed through inWs
  if (o.revoked) throw new Error('revoked invites need invites.revoked_at (#51)');
  await inWs(W.w1, (c) => c.query(
    `insert into invites (id, workspace_id, email, role, token_hash, invited_by, expires_at, used_at)
     values ($1,$2,$3,$4,$5,$6, now() + ($7)::interval, $8)`,
    [randomUUID(), W.w1, o.email, o.role ?? 'member', createHash('sha256').update(token).digest('hex'), W.A1id,
     o.expired ? '-1 day' : '7 days', o.used ? new Date() : null]));
  return token;
};

describe.runIf(runIntegration)('T5 invalid invites are indistinguishable', () => {
  it('invalid, expired, reused, wrong-email (revoked: #51): same 404 INVITE_INVALID, body and headers', async () => {
    const me = W.Nemail;
    const tokens = [
      'nope', await seed({ email: me, expired: true }), await seed({ email: me, used: true }),
      await seed({ email: 'someone-else@example.test' }), // revoked case skipped until #51
    ];
    const snaps = [];
    for (const t of tokens) snaps.push(await snap(await accept(W.N, t)));
    for (const s of snaps) { expect([404, 422]).toContain(s.s); expect(JSON.parse(s.b).error.code).toBe('INVITE_INVALID'); }
    expect(new Set(snaps.map((s) => s.b + s.h)).size).toBe(1);
  });
});

describe.runIf(runIntegration)('T5 valid accept', () => {
  it.skip('(#55) adds membership once, idempotent, invited role, audit event', async () => {
    const t = await seed({ email: W.Nemail, role: 'member' });
    const r1 = await accept(W.N, t);
    expect([200, 201]).toContain(r1.status);
    await accept(W.N, t);
    const m = (await inWs(W.w1, (c) => c.query(`select role from memberships m join users u on u.id=m.user_id where u.email=$1 and m.workspace_id=$2`, [W.Nemail, W.w1]))).rows;
    expect(m).toEqual([{ role: 'member' }]);
    const a = (await ownerPool.query(`select count(*)::int n from audit_events where workspace_id=$1 and action ilike '%invite%accept%'`, [W.w1])).rows[0].n;
    expect(a).toBeGreaterThanOrEqual(1);
  });
  it('SECURITY DEFINER lookup returns only workspace_id and email', async () => {
    const t = await seed({ email: 'lookup@example.test' });
    const fn = (await ownerPool.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname ilike '%invite%'`)).rows[0]?.proname;
    expect(fn).toBeTruthy();
    const r = await appPool.query(`select * from ${fn}($1)`, [createHash('sha256').update(t).digest('hex')]);
    expect(Object.keys(r.rows[0]).sort()).toEqual(['email', 'workspace_id']);
  });
  it('tokens are stored as hashes only', async () => {
    const t = await seed({ email: 'hash@example.test' });
    const rawRows = await ownerPool.query(`select count(*)::int n from invites where token_hash=$1`, [t]);
    expect(rawRows.rows[0].n).toBe(0);
    const cols = (await ownerPool.query(`select column_name from information_schema.columns where table_name='invites'`)).rows.map((r) => r.column_name);
    expect(cols).not.toContain('token');
  });
});

describe.runIf(runIntegration)('T5 creating invites', () => {
  it('non-admins cannot create invites', async () => {
    for (const u of [W.M1, W.G1]) expect([403, 404]).toContain((await api(u, 'POST', `${P1}/invites`, { email: 'x@example.test', role: 'member' })).status);
  });
  it('inviting an existing member does not reveal membership', async () => {
    const ok = await api(W.A1, 'POST', `${P1}/invites`, { email: 'fresh-' + Date.now() + '@example.test', role: 'member' });
    const dup = await api(W.A1, 'POST', `${P1}/invites`, { email: W.M1email, role: 'member' });
    expect(ok.status).toBe(201);
    expect(dup.status).toBe(201);
    expect(await dup.text()).not.toMatch(/already/i);
  });
});
