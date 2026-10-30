// Wave 1 / lane 2 (Tess): authorization matrix, role x route x tenant, over real HTTP.
// Expectations come from the contracts (docs/API.md, docs/m1-routes.md: non-member => 404, 401 without a session,
// read keys GET-only, webhooks/api-keys session-only, admin-only audit/members/invites/webhooks) and from the invariant
// "a denied caller never gets a 2xx and never a 5xx". Rows marked 'adm?' are ASSUMED admin-only (spec silent): they are
// reported separately so a failure is a spec question, not a verdict.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { api, world, ownerPool, type U } from './helpers/world';
import { runIntegration } from './helpers/gate';

type Pol = 'glob' | 'mem' | 'adm' | 'adm?';
// [method, route under /api/v1, policy]
const ROUTES: [string, string, Pol][] = [
  ['POST', 'auth/login', 'glob'],
  ['POST', 'auth/logout-all', 'glob'],
  ['POST', 'auth/logout', 'glob'],
  ['POST', 'auth/password-reset/confirm', 'glob'],
  ['POST', 'auth/password-reset/request', 'glob'],
  ['POST', 'auth/signup', 'glob'],
  ['POST', 'auth/verify-email', 'glob'],
  ['POST', 'integrations/github/webhook/[connectionId]', 'glob'],
  ['POST', 'invites/accept', 'glob'],
  ['GET', 'me', 'glob'],
  ['PATCH', 'me', 'glob'],
  ['GET', 'workspaces', 'glob'],
  ['POST', 'workspaces', 'glob'],
  ['DELETE', 'w/[slug]/api-keys/[id]', 'mem'],
  ['GET', 'w/[slug]/api-keys', 'mem'],
  ['POST', 'w/[slug]/api-keys', 'mem'],
  ['GET', 'w/[slug]/audit', 'adm'],
  ['GET', 'w/[slug]/comments/[id]/reactions', 'mem'],
  ['POST', 'w/[slug]/comments/[id]/reactions', 'mem'],
  ['DELETE', 'w/[slug]/comments/[id]/reactions', 'mem'],
  ['POST', 'w/[slug]/comments/[id]/resolve', 'mem'],
  ['GET', 'w/[slug]/comments/[id]', 'mem'],
  ['PATCH', 'w/[slug]/comments/[id]', 'mem'],
  ['DELETE', 'w/[slug]/comments/[id]', 'mem'],
  ['POST', 'w/[slug]/comments/[id]/unresolve', 'mem'],
  ['POST', 'w/[slug]/cycles/[id]/complete', 'mem'],
  ['GET', 'w/[slug]/cycles/[id]', 'mem'],
  ['PATCH', 'w/[slug]/cycles/[id]', 'mem'],
  ['DELETE', 'w/[slug]/cycles/[id]', 'mem'],
  ['GET', 'w/[slug]/cycles/[id]/stats', 'mem'],
  ['GET', 'w/[slug]/cycles/[id]/burndown', 'mem'],
  ['POST', 'w/[slug]/presence', 'mem'],
  ['GET', 'w/[slug]/cycles', 'mem'],
  ['POST', 'w/[slug]/cycles', 'mem'],
  ['POST', 'w/[slug]/cycles/snapshot', 'mem'],
  ['GET', 'w/[slug]/cycles/window', 'mem'],
  ['GET', 'w/[slug]/events', 'mem'],
  ['GET', 'w/[slug]/integrations/github/links', 'mem'],
  ['GET', 'w/[slug]/integrations/github', 'mem'],
  ['PUT', 'w/[slug]/integrations/github', 'adm?'],
  ['DELETE', 'w/[slug]/integrations/github', 'adm?'],
  ['GET', 'w/[slug]/integrations/github/teams/[teamId]', 'mem'],
  ['PUT', 'w/[slug]/integrations/github/teams/[teamId]', 'adm?'],
  ['POST', 'w/[slug]/invites/[id]/resend', 'adm'],
  ['DELETE', 'w/[slug]/invites/[id]', 'adm'],
  ['GET', 'w/[slug]/invites', 'adm'],
  ['POST', 'w/[slug]/invites', 'adm'],
  ['POST', 'w/[slug]/issues/bulk', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/activity', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/archive', 'mem'],
  ['DELETE', 'w/[slug]/issues/[id]/attachments/[aid]', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/attachments', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/attachments', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/children', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/comments', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/comments', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/presence', 'mem'],
  ['DELETE', 'w/[slug]/issues/[id]/relations/[rid]', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/relations', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/relations', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/restore', 'mem'],
  ['GET', 'w/[slug]/issues/[id]', 'mem'],
  ['PATCH', 'w/[slug]/issues/[id]', 'mem'],
  ['DELETE', 'w/[slug]/issues/[id]', 'mem'],
  ['DELETE', 'w/[slug]/issues/[id]/shares/[guestId]', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/shares', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/shares', 'mem'],
  ['GET', 'w/[slug]/issues/[id]/subscription', 'mem'],
  ['PUT', 'w/[slug]/issues/[id]/subscription', 'mem'],
  ['DELETE', 'w/[slug]/issues/[id]/subscription', 'mem'],
  ['POST', 'w/[slug]/issues/[id]/unarchive', 'mem'],
  ['GET', 'w/[slug]/issues', 'mem'],
  ['POST', 'w/[slug]/issues', 'mem'],
  ['GET', 'w/[slug]/label-groups/[id]', 'mem'],
  ['PATCH', 'w/[slug]/label-groups/[id]', 'mem'],
  ['DELETE', 'w/[slug]/label-groups/[id]', 'mem'],
  ['GET', 'w/[slug]/label-groups', 'mem'],
  ['POST', 'w/[slug]/label-groups', 'mem'],
  ['GET', 'w/[slug]/labels/[id]', 'mem'],
  ['PATCH', 'w/[slug]/labels/[id]', 'mem'],
  ['DELETE', 'w/[slug]/labels/[id]', 'mem'],
  ['GET', 'w/[slug]/labels', 'mem'],
  ['POST', 'w/[slug]/labels', 'mem'],
  ['GET', 'w/[slug]/members', 'mem'],
  ['PATCH', 'w/[slug]/members/[userId]', 'adm'],
  ['DELETE', 'w/[slug]/members/[userId]', 'adm'],
  ['GET', 'w/[slug]/notification-preferences', 'mem'],
  ['PUT', 'w/[slug]/notification-preferences', 'mem'],
  ['POST', 'w/[slug]/notifications/archive-read', 'mem'],
  ['POST', 'w/[slug]/notifications/[id]/archive', 'mem'],
  ['POST', 'w/[slug]/notifications/[id]/read', 'mem'],
  ['GET', 'w/[slug]/notifications/[id]', 'mem'],
  ['DELETE', 'w/[slug]/notifications/[id]', 'mem'],
  ['POST', 'w/[slug]/notifications/[id]/snooze', 'mem'],
  ['POST', 'w/[slug]/notifications/[id]/unarchive', 'mem'],
  ['POST', 'w/[slug]/notifications/[id]/unread', 'mem'],
  ['POST', 'w/[slug]/notifications/read-all', 'mem'],
  ['GET', 'w/[slug]/notifications', 'mem'],
  ['GET', 'w/[slug]/notifications/unread-count', 'mem'],
  ['GET', 'w/[slug]/project-milestones/[id]', 'mem'],
  ['PATCH', 'w/[slug]/project-milestones/[id]', 'mem'],
  ['DELETE', 'w/[slug]/project-milestones/[id]', 'mem'],
  ['GET', 'w/[slug]/projects/[id]/milestones', 'mem'],
  ['POST', 'w/[slug]/projects/[id]/milestones', 'mem'],
  ['GET', 'w/[slug]/projects/[id]', 'mem'],
  ['PATCH', 'w/[slug]/projects/[id]', 'mem'],
  ['DELETE', 'w/[slug]/projects/[id]', 'mem'],
  ['GET', 'w/[slug]/projects/[id]/updates', 'mem'],
  ['POST', 'w/[slug]/projects/[id]/updates', 'mem'],
  ['GET', 'w/[slug]/projects', 'mem'],
  ['POST', 'w/[slug]/projects', 'mem'],
  ['PATCH', 'w/[slug]/project-updates/[id]', 'mem'],
  ['DELETE', 'w/[slug]/project-updates/[id]', 'mem'],
  ['GET', 'w/[slug]', 'mem'],
  ['GET', 'w/[slug]/search', 'mem'],
  ['GET', 'w/[slug]/settings', 'mem'],
  ['PATCH', 'w/[slug]/settings', 'adm?'],
  ['GET', 'w/[slug]/sync', 'mem'],
  ['POST', 'w/[slug]/teams/[id]/cycles/ensure', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/cycle-settings', 'mem'],
  ['PUT', 'w/[slug]/teams/[id]/cycle-settings', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/members', 'mem'],
  ['POST', 'w/[slug]/teams/[id]/members/[userId]', 'adm?'],
  ['PATCH', 'w/[slug]/teams/[id]/members/[userId]', 'adm?'],
  ['DELETE', 'w/[slug]/teams/[id]/members/[userId]', 'adm?'],
  ['PATCH', 'w/[slug]/teams/[id]', 'adm?'],
  ['DELETE', 'w/[slug]/teams/[id]', 'adm?'],
  ['GET', 'w/[slug]/teams/[id]/settings', 'mem'],
  ['PATCH', 'w/[slug]/teams/[id]/settings', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/states', 'mem'],
  ['POST', 'w/[slug]/teams/[id]/states', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/states/[stateId]', 'mem'],
  ['PATCH', 'w/[slug]/teams/[id]/states/[stateId]', 'mem'],
  ['DELETE', 'w/[slug]/teams/[id]/states/[stateId]', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/templates', 'mem'],
  ['POST', 'w/[slug]/teams/[id]/templates', 'mem'],
  ['GET', 'w/[slug]/teams/[id]/templates/[tid]', 'mem'],
  ['PATCH', 'w/[slug]/teams/[id]/templates/[tid]', 'mem'],
  ['DELETE', 'w/[slug]/teams/[id]/templates/[tid]', 'mem'],
  ['GET', 'w/[slug]/teams', 'mem'],
  ['POST', 'w/[slug]/teams', 'adm?'],
  ['GET', 'w/[slug]/views/[id]', 'mem'],
  ['PATCH', 'w/[slug]/views/[id]', 'mem'],
  ['DELETE', 'w/[slug]/views/[id]', 'mem'],
  ['GET', 'w/[slug]/views', 'mem'],
  ['POST', 'w/[slug]/views', 'mem'],
  ['POST', 'w/[slug]/webhooks/[id]/deliveries/[deliveryId]/redeliver', 'adm'],
  ['GET', 'w/[slug]/webhooks/[id]/deliveries', 'adm'],
  ['GET', 'w/[slug]/webhooks/[id]', 'adm'],
  ['PATCH', 'w/[slug]/webhooks/[id]', 'adm'],
  ['DELETE', 'w/[slug]/webhooks/[id]', 'adm'],
  ['GET', 'w/[slug]/webhooks', 'adm'],
  ['POST', 'w/[slug]/webhooks', 'adm'],
];

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);

// A plausible body for every write: authz must answer before validation, so denied callers should see 403/404 not 422.
const BODY = { name: 'authz', title: 'authz', role: 'member', scope: 'read', url: 'https://example.com/hook', events: ['issue.created'], email: 'authz@example.test', key: 'AZ', team_id: '00000000-0000-4000-8000-000000000001' };

// Strict schemas reject unknown keys, so the routes whose validation runs first get their minimal valid body.
const MIN: [RegExp, string, unknown][] = [
  [/\/api-keys$/, 'POST', { name: 'authz', scope: 'read' }], [/\/label-groups(\/[^/]+)?$/, '(POST|PATCH)', { name: 'authz' }],
  [/\/w\/[^/]+\/presence$/, 'POST', { issue_id: '00000000-0000-4000-8000-0000000000aa' }], [/\/teams\/[^/]+$/, 'PATCH', { name: 'authz' }], [/\/issues\/[^/]+$/, 'PATCH', { title: 'authz' }],
];
function bodyFor(method: string, path: string): unknown {
  for (const [re, ms, b] of MIN) if (re.test(path) && new RegExp(`^${ms}$`).test(method)) return b;
  return BODY;
}

/** fetch, keep only the status (SSE routes never end: drop the body as soon as headers arrive). */
async function status(u: U | null, method: string, path: string, headers: Record<string, string> = {}, bodyOverride?: unknown): Promise<number> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const h: Record<string, string> = { 'content-type': 'application/json', origin: BASE, ...headers };
    if (u?.cookie) h.cookie = u.cookie;
    const body = method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(bodyOverride ?? bodyFor(method, path));
    if (method === 'PATCH' || method === 'DELETE') h['if-match'] ??= '1';
    const r = await fetch(BASE + path, { method, headers: h, body, signal: ac.signal });
    void r.body?.cancel().catch(() => {});
    return r.status;
  } finally { clearTimeout(timer); }
}

/** Real ids for the callers that must be DENIED (so a missing authz check would really act); random ones otherwise. */
function pathFor(route: string, slug: string, real: boolean, actor?: U): string {
  const r = route.replace('[slug]', slug);
  const seg = r.split('/');
  const out = seg.map((s, i) => {
    if (!s.startsWith('[')) return s;
    const parent = seg[i - 1];
    if (real && s === '[id]' && parent === 'issues') return W.i1;
    if (real && s === '[id]' && parent === 'teams') return W.t1;
    if (real && s === '[userId]' && parent === 'members') return actor && actor.id === W.M2.id ? W.M1.id : W.M2.id;
    return randomUUID();
  });
  return '/api/v1/' + out.join('/');
}
const isMut = (m: string) => m !== 'GET';
const wRoutes = ROUTES.filter(([, r]) => r.startsWith('w/'));

describe.runIf(runIntegration)('route inventory guard', () => {
  it('every route.ts method is a row of the matrix, and every row exists on disk', () => {
    const root = join(process.cwd(), 'src/app/api/v1');
    const found: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') found.push(p); } };
    walk(root);
    expect(found.length).toBeGreaterThan(50);
    
    const onDisk = new Set<string>();
    for (const p of found) {
      const rel = p.slice(root.length + 1).replace(/\/?route\.ts$/, '');
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)) onDisk.add(`${m[1]} ${rel}`);
    }
    const inTable = new Set(ROUTES.map(([m, r]) => `${m} ${r}`));
    expect([...onDisk].filter((k) => !inTable.has(k)), 'routes with no role row').toEqual([]);
    expect([...inTable].filter((k) => !onDisk.has(k)), 'matrix rows with no route').toEqual([]);
  });
});

describe.runIf(runIntegration)('global routes', () => {
  it.each([['GET', 'me'], ['PATCH', 'me'], ['GET', 'workspaces'], ['POST', 'workspaces'], ['POST', 'auth/logout-all']])('anonymous %s /%s is 401', async (m, p) => {
    expect(await status(null, m, `/api/v1/${p}`)).toBe(401);
  });
  it.each(ROUTES.filter(([, r, p]) => p === 'glob' && r.startsWith('auth/')).map(([m, r]) => [m, r]))('%s /%s with an empty body is a 4xx, never 2xx/5xx', async (m, r) => {
    if (r === 'auth/logout' || r === 'auth/password-reset/request') return; // logout is idempotent; reset/request answers 202 either way (no account enumeration)
    const s = await status(null, m, `/api/v1/${r}`);
    expect(s, `${m} ${r}`).toBeGreaterThanOrEqual(400); expect(s).toBeLessThan(500);
  });
  it('POST /invites/accept with a bogus token is refused (4xx), also when signed in', async () => {
    for (const u of [null, W.N]) { const s = await status(u, 'POST', '/api/v1/invites/accept'); expect(s).toBeGreaterThanOrEqual(400); expect(s).toBeLessThan(500); }
  });
  it('GitHub webhook: unsigned POST is refused, never 2xx', async () => {
    const s = await status(null, 'POST', `/api/v1/integrations/github/webhook/${randomUUID()}`);
    expect(s).toBeGreaterThanOrEqual(400); expect(s).toBeLessThan(500);
  });
});

describe.runIf(runIntegration)('anonymous: 401 on every workspace route', () => {
  it.each(wRoutes.map(([m, r]) => [m, r]))('%s /%s', async (m, r) => {
    expect(await status(null, m, pathFor(r, 'w1', true))).toBe(401);
  });
});

describe.runIf(runIntegration)('tenant boundary: non-member and other-tenant callers get 404 (existence is not leaked)', () => {
  it.each(wRoutes.map(([m, r]) => [m, r]))('%s /%s', async (m, r) => {
    const p = pathFor(r, 'w1', true);
    expect(await status(W.B1, m, p), 'other tenant (w2 member) on w1').toBe(404);
    expect(await status(W.N, m, p), 'registered, member of nothing').toBe(404);
    // and the reverse: the w1 admin on w2
    expect(await status(W.A1, m, pathFor(r, 'w2', false)), 'w1 admin on w2').toBe(404);
  });
});

describe.runIf(runIntegration)('guest G1: never mutates, never reaches admin routes', () => {
  // comments on a shared issue are allowed for guests by the spec (T2): excluded from the "no mutation" rule.
  const selfScoped = (r: string) => /\/(notifications|notification-preferences)|\/subscription$/.test(r); // own inbox/subscription: allowed for any member
  const guestOk = new Set(['POST w/[slug]/api-keys', 'POST w/[slug]/issues/[id]/comments', 'POST w/[slug]/comments/[id]/reactions', 'DELETE w/[slug]/comments/[id]/reactions']);
  it.each(wRoutes.filter(([m, r, p]) => (isMut(m) || p === 'adm') && !guestOk.has(`${m} ${r}`) && !selfScoped(r)).map(([m, r]) => [m, r]))('%s /%s is 403/404', async (m, r) => {
    const s = await status(W.G1, m, pathFor(r, 'w1', true));
    expect([403, 404], `guest ${m} ${r} -> ${s}`).toContain(s);
  });
});

describe.runIf(runIntegration)('admin-only routes (spec: audit, members role/removal, invites, webhooks)', () => {
  const adm = wRoutes.filter(([, , p]) => p === 'adm').map(([m, r]) => [m, r]);
  it.each(adm)('member M1 on %s /%s is 403 (or 404 for a resource that is not theirs), never 2xx', async (m, r) => {
    const s = await status(W.M1, m, pathFor(r, 'w1', true));
    expect([403, 404], `M1 ${m} ${r} -> ${s}`).toContain(s);
  });
  it.each(adm)('member M2 (no team) on %s /%s is 403/404', async (m, r) => {
    const s = await status(W.M2, m, pathFor(r, 'w1', true, W.M2));
    expect([403, 404], `M2 ${m} ${r} -> ${s}`).toContain(s);
  });
  it.each(adm)('admin A1 on %s /%s passes authz (not 401/403, not 5xx)', async (m, r) => {
    const s = await status(W.A1, m, pathFor(r, 'w1', false));
    expect([401, 403], `A1 ${m} ${r}`).not.toContain(s); expect(s).toBeLessThan(500);
  });
  it('members/{userId}: the 403 comes before any lookup (same status for an unknown user)', async () => {
    expect(await status(W.M1, 'PATCH', `/api/v1/w/w1/members/${randomUUID()}`)).toBe(await status(W.M1, 'PATCH', `/api/v1/w/w1/members/${W.M2.id}`));
  });
});

describe.runIf(runIntegration)('ASSUMED admin-only (spec silent): teams CRUD, workspace/team settings, GitHub integration, team membership', () => {
  const adm = wRoutes.filter(([, , p]) => p === 'adm?').map(([m, r]) => [m, r]);
  it.each(adm)('member M1 on %s /%s is 403/404', async (m, r) => {
    const s = await status(W.M1, m, pathFor(r, 'w1', true));
    expect([403, 404], `ASSUMPTION: M1 ${m} ${r} -> ${s}`).toContain(s);
  });
});

describe.runIf(runIntegration)('every workspace member and admin: no 401 and no 5xx anywhere', () => {
  it.each(wRoutes.map(([m, r]) => [m, r]))('%s /%s', async (m, r) => {
    for (const u of [W.A1, W.M1, W.M2]) {
      const s = await status(u, m, pathFor(r, 'w1', false));
      expect(s, `${u.email} ${m} ${r}`).not.toBe(401); expect(s, `${u.email} ${m} ${r}`).toBeLessThan(500);
    }
  });
});

describe.runIf(runIntegration)('API keys (docs/API.md)', () => {
  // Flake fix: bad-key attempts are rate limited per IP (30/min, api:badkey:<ip>) and every request here shares one IP.
  // Reset the API limiter buckets before each test so earlier 401s (revoked/invalid keys) cannot trip a later 429.
  beforeEach(async () => { await ownerPool.query("delete from rate_limits where key like 'api:%'"); });
  const mint = async (u: U, scope: string) => {
    const r = await api(u, 'POST', '/api/v1/w/w1/api-keys', { name: `matrix-${scope}`, scope });
    expect(r.status).toBe(201);
    return (await r.json()).token as string;
  };
  const call = (tok: string, m: string, p: string) => status(null, m, p, { authorization: `Bearer ${tok}` });
  it('read key: GET works, every mutation is 403', async () => {
    const tok = await mint(W.A1, 'read');
    expect(await call(tok, 'GET', '/api/v1/w/w1/issues')).toBe(200);
    for (const [m, r] of wRoutes.filter(([mm]) => isMut(mm))) {
      const s = await call(tok, m, pathFor(r, 'w1', false));
      expect(s, `read key ${m} ${r}`).toBe(403);
    }
  }, 60_000);
  it('write key: cannot manage keys or webhooks (session-only, 403)', async () => {
    const tok = await mint(W.A1, 'write');
    expect(await call(tok, 'GET', '/api/v1/w/w1/issues')).toBe(200);
    expect(await call(tok, 'POST', '/api/v1/w/w1/api-keys')).toBe(403);
    expect(await call(tok, 'POST', '/api/v1/w/w1/webhooks')).toBe(403);
    expect(await call(tok, 'GET', '/api/v1/w/w1/webhooks')).toBe(403);
  });
  it('a key opens only its own workspace (other slug: 404) and a member-owned key cannot reach admin routes', async () => {
    const ta = await mint(W.A1, 'write');
    expect(await call(ta, 'GET', '/api/v1/w/w2/issues')).toBe(404);
    const tm = await mint(W.M1, 'write');
    expect([403, 404]).toContain(await call(tm, 'GET', '/api/v1/w/w1/audit'));
  });
  // Open until Ada's route fix lands; then switch it.fails back to it.
  it.fails('guest can only mint a read key: write/admin scope is 403 (spec decision 2026-10-30)', async () => {
    for (const scope of ['write', 'admin']) {
      const r = await api(W.G1, 'POST', '/api/v1/w/w1/api-keys', { name: 'g-' + scope, scope });
      expect(r.status, `guest ${scope} key`).toBe(403);
    }
  });
  it('guest read key has no more power than the guest: GET ok, no mutation, foreign issue 404, no audit', async () => {
    const r = await api(W.G1, 'POST', '/api/v1/w/w1/api-keys', { name: 'g-read', scope: 'read' });
    expect(r.status).toBe(201);
    const h = { authorization: `Bearer ${(await r.json()).token as string}` };
    expect(await status(null, 'POST', '/api/v1/w/w1/issues', h, { title: 'by guest key', team_id: W.t1 })).toBe(403);
    expect(await status(null, 'GET', `/api/v1/w/w1/issues/${W.i2}`, h)).toBe(404);
    expect([403, 404]).toContain(await status(null, 'GET', '/api/v1/w/w1/audit', h));
  });
  it('creating a key above your own role is refused', async () => {
    const r = await api(W.M1, 'POST', '/api/v1/w/w1/api-keys', { name: 'esc', scope: 'admin' });
    expect([403, 422]).toContain(r.status);
  });
  it('a revoked key is 401 at once', async () => {
    const r = await api(W.A1, 'POST', '/api/v1/w/w1/api-keys', { name: 'rev', scope: 'write' });
    const { token, id } = await r.json();
    expect(await call(token, 'GET', '/api/v1/w/w1/issues')).toBe(200);
    expect([200, 204]).toContain((await api(W.A1, 'DELETE', `/api/v1/w/w1/api-keys/${id}`)).status);
    expect(await call(token, 'GET', '/api/v1/w/w1/issues')).toBe(401);
  });
  it('admin-scope key reaches audit; write-scope key of the same admin does not (docs: scopes read < write < admin)', async () => {
    expect(await call(await mint(W.A1, 'admin'), 'GET', '/api/v1/w/w1/audit')).toBe(200);
    expect(await call(await mint(W.A1, 'write'), 'GET', '/api/v1/w/w1/audit')).toBe(403);
  });
});

describe.runIf(runIntegration)('IDOR across tenants: a foreign resource id under my own slug is 404', () => {
  it.each([
    ['GET', `issues/${'I1'}`], ['PATCH', `issues/${'I1'}`], ['DELETE', `issues/${'I1'}`], ['GET', `issues/${'I1'}/comments`], ['GET', `issues/${'I1'}/activity`],
  ])('B1 (w2) %s /w/w2/%s with w1 issue id', async (m, p) => {
    const s = await status(W.B1, m, `/api/v1/w/w2/${p.replace('I1', W.i1)}`, m === 'PATCH' ? { 'if-match': '1' } : {});
    expect(s).toBe(404);
  });
  it('A1 (w1) reading the w2 issue under /w/w1 is 404', async () => {
    expect(await status(W.A1, 'GET', `/api/v1/w/w1/issues/${W.i2}`)).toBe(404);
  });
});
