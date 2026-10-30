// Lane 3 (hardening): semantic validation and cross-reference integrity on the core write routes.
// Every case must be a clear 4xx with the standard error envelope (code + request_id), never a 2xx and never a 500.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { api, world, inWs } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
let foreign: { project: string; label: string; issue: string };
const P = '/api/v1/w/w1';
beforeAll(async () => {
  if (!runIntegration) return;
  W = await world();
  await inWs(W.w2, (c) => c.query('insert into team_memberships (workspace_id, team_id, user_id) values ($1,$2,$3) on conflict do nothing', [W.w2, W.t2, W.B1.id]));
  const proj = await (await api(W.B1, 'POST', '/api/v1/w/w2/projects', { name: 'foreign', description: '', team_ids: [W.t2], icon: null, color: null, lead_id: null, status: 'planned', start_date: null, target_date: null, member_ids: [] })).json();
  const lab = await (await api(W.B1, 'POST', '/api/v1/w/w2/labels', { name: 'foreign-label' })).json();
  if (!proj.id || !lab.id) throw new Error('fixture: ' + JSON.stringify([proj, lab]));
  foreign = { project: proj.id, label: lab.id, issue: W.i2 };
}, 60_000);

const expect4xx = async (r: Response, codes: number[] = [400, 404, 409, 422]) => {
  const txt = await r.text();
  expect(codes, `${r.status} ${txt}`).toContain(r.status);
  const j = JSON.parse(txt);
  expect(j.error.code).toBeTruthy(); expect(j.error.request_id).toBeTruthy();
};

describe.runIf(runIntegration)('issue create/update: references must belong to the workspace', () => {
  const base = () => ({ title: 'ref check', team_id: W.t1 });
  it.each([
    ['team of another workspace', () => ({ team_id: W.t2 })],
    ['assignee who is not a member', () => ({ assignee_id: W.N.id })],
    ['assignee from another workspace', () => ({ assignee_id: W.B1.id })],
    ['project of another workspace', () => ({ project_id: foreign.project })],
    ['label of another workspace', () => ({ label_ids: [foreign.label] })],
    ['parent issue of another workspace', () => ({ parent_id: foreign.issue })],
    ['unknown project', () => ({ project_id: randomUUID() })],
    ['unknown cycle', () => ({ cycle_id: randomUUID() })],
    ['unknown state', () => ({ state_id: randomUUID() })],
    ['impossible date', () => ({ due_date: '2026-02-30' })],
    ['whitespace-only title', () => ({ title: '    ' })],
    ['title over 255', () => ({ title: 'x'.repeat(256) })],
    ['priority out of range', () => ({ priority: 9 })],
    ['unknown field', () => ({ nope: 1 })],
  ])('POST issue with %s -> 4xx', async (_n, patch) => {
    await expect4xx(await api(W.M1, 'POST', `${P}/issues`, { ...base(), ...patch() }));
  });

  it.each([
    ['assignee who is not a member', () => ({ assignee_id: W.N.id })],
    ['assignee from another workspace', () => ({ assignee_id: W.B1.id })],
    ['project of another workspace', () => ({ project_id: foreign.project })],
    ['label of another workspace', () => ({ label_ids: [foreign.label] })],
    ['parent issue of another workspace', () => ({ parent_id: foreign.issue })],
    ['self as parent', () => ({ parent_id: 'SELF' })],
    ['null title', () => ({ title: null })],
    ['whitespace-only title', () => ({ title: '   ' })],
  ])('PATCH issue with %s -> 4xx', async (_n, patch) => {
    const c = await api(W.M1, 'POST', `${P}/issues`, base());
    const iss = await c.json(); const etag = c.headers.get('etag')!;
    const body = JSON.parse(JSON.stringify(patch()).replace('SELF', iss.id));
    await expect4xx(await api(W.M1, 'PATCH', `${P}/issues/${iss.id}`, body, { 'if-match': etag }));
  });

  it('PATCH without If-Match is 428 and with a stale version is 412', async () => {
    const c = await api(W.M1, 'POST', `${P}/issues`, base());
    const iss = await c.json();
    await expect4xx(await api(W.M1, 'PATCH', `${P}/issues/${iss.id}`, { title: 'a' }), [428]);
    await expect4xx(await api(W.M1, 'PATCH', `${P}/issues/${iss.id}`, { title: 'a' }, { 'if-match': '"99"' }), [412]);
  });
});

describe.runIf(runIntegration)('other write routes: references and ranges', () => {
  it('comment on an issue of another workspace is 404', async () => {
    await expect4xx(await api(W.M1, 'POST', `${P}/issues/${foreign.issue}/comments`, { body: 'hi' }), [404]);
  });
  it('comment: empty body 422, parent comment of another issue 4xx', async () => {
    const a = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'a', team_id: W.t1 })).json();
    const b = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'b', team_id: W.t1 })).json();
    await expect4xx(await api(W.M1, 'POST', `${P}/issues/${a.id}/comments`, { body: '' }), [422]);
    const cb = await (await api(W.M1, 'POST', `${P}/issues/${b.id}/comments`, { body: 'on b' })).json();
    await expect4xx(await api(W.M1, 'POST', `${P}/issues/${a.id}/comments`, { body: 'reply', parent_comment_id: cb.id }));
  });
  it('relation to an issue of another workspace, or to itself, is 4xx', async () => {
    const a = await (await api(W.M1, 'POST', `${P}/issues`, { title: 'rel', team_id: W.t1 })).json();
    const body = (id: string) => ({ type: 'blocks', related_issue_id: id, issue_id: id, target_id: id });
    for (const id of [foreign.issue, a.id]) {
      const r = await api(W.M1, 'POST', `${P}/issues/${a.id}/relations`, body(id));
      expect(r.status, await r.clone().text()).toBeLessThan(500); expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });
  it('cycle with end before start, impossible dates, or a foreign team is 4xx', async () => {
    await expect4xx(await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'c', start_date: '2026-05-10', end_date: '2026-05-01' }));
    await expect4xx(await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t1, name: 'c', start_date: '2026-13-01', end_date: '2026-14-01' }));
    await expect4xx(await api(W.A1, 'POST', `${P}/cycles`, { team_id: W.t2, name: 'c', start_date: '2026-05-01', end_date: '2026-05-10' }));
  });
  it('project with a team of another workspace, or an empty name, is 4xx', async () => {
    await expect4xx(await api(W.M1, 'POST', `${P}/projects`, { name: 'p', description: '', team_ids: [W.t2] }));
    await expect4xx(await api(W.M1, 'POST', `${P}/projects`, { name: '   ', description: '', team_ids: [W.t1] }));
  });
  it('label with an empty name or a malformed color is 4xx', async () => {
    await expect4xx(await api(W.M1, 'POST', `${P}/labels`, { name: '   ' }));
    await expect4xx(await api(W.M1, 'POST', `${P}/labels`, { name: 'colored', color: 'not-a-color' }));
  });
  it('webhook with a non-http(s) url is refused (private hosts are allowed in CI via ML_WEBHOOKS_ALLOW_PRIVATE)', async () => {
    for (const url of ['ftp://example.com/h', 'javascript:alert(1)']) {
      await expect4xx(await api(W.A1, 'POST', `${P}/webhooks`, { url, events: ['issue.created'] }));
    }
  });
  it('members: a member cannot change roles; an unknown role is 4xx; a non-member userId is 404', async () => {
    await expect4xx(await api(W.M1, 'PATCH', `${P}/members/${W.M2.id}`, { role: 'admin' }), [403]);
    await expect4xx(await api(W.A1, 'PATCH', `${P}/members/${W.M2.id}`, { role: 'superuser' }), [422]);
    await expect4xx(await api(W.A1, 'PATCH', `${P}/members/${W.B1.id}`, { role: 'member' }), [404]);
  });
  it('workspace settings: empty patch, invalid slug and non-http logo are 4xx', async () => {
    await expect4xx(await api(W.A1, 'PATCH', `${P}/settings`, {}));
    await expect4xx(await api(W.A1, 'PATCH', `${P}/settings`, { slug: 'Bad Slug!' }));
    await expect4xx(await api(W.A1, 'PATCH', `${P}/settings`, { logo_url: 'javascript:alert(1)' }));
  });
  it('guest cannot create issues, projects, labels, cycles or webhooks (403 with the envelope)', async () => {
    const calls: [string, unknown][] = [['issues', { title: 'g', team_id: W.t1 }], ['projects', { name: 'g', description: '', team_ids: [W.t1] }], ['labels', { name: 'g' }], ['cycles', { team_id: W.t1, name: 'g', start_date: '2026-05-01', end_date: '2026-05-10' }], ['webhooks', { url: 'https://example.com/h', events: ['issue.created'] }]];
    for (const [p, b] of calls) await expect4xx(await api(W.G1, 'POST', `${P}/${p}`, b), [403]);
  });
});
