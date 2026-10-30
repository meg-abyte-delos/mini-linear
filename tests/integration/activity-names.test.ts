import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import { nameFromEmail } from '../../src/lib/nl-people';
import * as A from "../../src/lib/issues/activity-attachments";
import * as C from "../../src/lib/resources/projects-comments";
import * as L from "../../src/lib/resources/labels-cycles";
import * as W from "../../src/lib/resources/workflow-states";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
type Fn = (r: Request, ...a: string[]) => Promise<Response>;
type Item = { action: string; entity: string; summary: string; actor_id: string; changes: { field: string; before: unknown; after: unknown }[] };

(haveDb ? describe : describe.skip)("activity feed resolves ids to names", () => {
  const owner = ownerSql(); let seed: Seed; let team = "";
  const call = (fn: Fn, user: string, method: string, body: unknown, ver: number | null, ...a: string[]) =>
    fn(new Request("http://x/api", { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "x-u": user, "content-type": "application/json", ...(ver === null ? {} : { "if-match": `"${ver}"` }) } }), ...a);
  const asOwner = <T>(f: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return f(tx); }) as Promise<T>;
  const make = async (title: string, extra: object = {}) => (await (await call(H.createIssue as Fn, seed.a.member, "POST", { team_id: team, title, ...extra }, null, seed.a.slug)).json()) as { id: string; version: number };
  const patch = async (id: string, ver: number, body: object) => {
    const r = await call(H.patchIssue as Fn, seed.a.member, "PATCH", body, ver, seed.a.slug, id);
    expect(r.status).toBe(200); return (await r.json()) as { version: number };
  };
  const feed = async (id: string, user = seed.a.member): Promise<Item[]> => {
    const r = await call(A.listActivity as Fn, user, "GET", undefined, null, seed.a.slug, id);
    expect(r.status).toBe(200); return (await r.json()).items;
  };

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    team = randomUUID();
    await asOwner(async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ANAM')`;
      for (const u of [seed.a.member, seed.a.admin]) await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${u})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  const texts = async (id: string) => (await feed(id)).filter((x) => x.action === 'update').map((x) => x.summary);
  const mkLabel = async (name: string) => (await (await call(L.createLabel as Fn, seed.a.member, 'POST', { name, team_id: null }, null, seed.a.slug)).json()) as { id: string; version: number };
  const mkProject = async (name: string) => (await (await call(C.createProject as Fn, seed.a.admin, 'POST', { name, team_ids: [team] }, null, seed.a.slug)).json()) as { id: string; version: number };
  let day = 0;
  const mkCycle = async (name: string) => {
    day += 20; const d = (n: number) => new Date(Date.UTC(2040, 0, day + n)).toISOString().slice(0, 10);
    return (await (await call(L.createCycle as Fn, seed.a.admin, 'POST', { team_id: team, name, start_date: d(0), end_date: d(10) }, null, seed.a.slug)).json()) as { id: string; version: number };
  };
  const UUID_PART = /[0-9a-f]{8}-[0-9a-f]{4}-/;

  it('assignee: set, changed and cleared show the member name, never the id', async () => {
    const i = await make('names assignee');
    const u0 = (await owner`select display_name, email from users where id = ${seed.a.admin}`)[0]!;
    const name = (u0.display_name as string | null) ?? nameFromEmail(u0.email as string);
    let v = (await patch(i.id, i.version, { assignee_id: seed.a.admin })).version;
    expect(await texts(i.id)).toContain(`set assignee to ${name}`);
    v = (await patch(i.id, v, { assignee_id: seed.a.member })).version;
    expect((await texts(i.id)).some((x) => x.startsWith(`changed assignee from ${name} to `))).toBe(true);
    await patch(i.id, v, { assignee_id: null });
    expect((await texts(i.id))[0]!.startsWith('cleared assignee (was ')).toBe(true);
    for (const x of await texts(i.id)) expect(x).not.toMatch(UUID_PART);
  });

  it(`assignee who left the workspace falls back to a former member`, async () => {
    const i = await make('names former');
    const gone = randomUUID(); const mail = `gone-${gone.slice(0, 8)}@example.test`;
    await owner`insert into users (id, email, password_hash) values (${gone}, ${mail}, 'x')`;
    await asOwner(async (tx) => { await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${seed.a.id}, ${gone}, 'member')`; });
    await patch(i.id, i.version, { assignee_id: gone });
    expect((await texts(i.id))[0]).toBe(`set assignee to ${nameFromEmail(mail)}`);
    await asOwner(async (tx) => { await tx`delete from memberships where workspace_id = ${seed.a.id} and user_id = ${gone}`; });
    expect((await texts(i.id))[0]).toBe('set assignee to a former member');
  });

  it('project and cycle show their names, then a deleted fallback once removed', async () => {
    const p = await mkProject('Names Project'), c = await mkCycle('Names Cycle');
    const i = await make('names project cycle');
    let v = (await patch(i.id, i.version, { project_id: p.id })).version;
    v = (await patch(i.id, v, { cycle_id: c.id })).version;
    let s = await texts(i.id);
    expect(s).toContain('set project to Names Project'); expect(s).toContain('set cycle to Names Cycle');
    const p2 = await mkProject('Second Project');
    await patch(i.id, v, { project_id: p2.id });
    expect(await texts(i.id)).toContain('changed project from Names Project to Second Project');
    expect((await call(C.deleteProject as Fn, seed.a.admin, 'DELETE', undefined, p.version, seed.a.slug, p.id)).status).toBe(204);
    expect((await call(L.deleteCycle as Fn, seed.a.admin, 'DELETE', undefined, c.version, seed.a.slug, c.id)).status).toBe(204);
    s = await texts(i.id);
    expect(s).toContain('changed project from a deleted project to Second Project');
    expect(s).toContain('set cycle to a deleted cycle');
    expect(s).toContain('cleared cycle (was a deleted cycle)');
  });

  it('labels are named when added and removed, several at once, and a deleted label falls back', async () => {
    const a = await mkLabel('Improvement'), b = await mkLabel('Bug names'), c = await mkLabel('Docs names');
    const i = await make('names labels');
    let v = (await patch(i.id, i.version, { label_ids: [a.id] })).version;
    expect((await texts(i.id))[0]).toBe('added Improvement');
    v = (await patch(i.id, v, { label_ids: [b.id, c.id] })).version;
    expect((await texts(i.id))[0]).toBe('added Bug names and Docs names and removed Improvement');
    expect((await call(L.deleteLabel as Fn, seed.a.admin, 'DELETE', undefined, a.version, seed.a.slug, a.id)).status).toBe(204);
    expect(await texts(i.id)).toContain('added a deleted label');
    void v;
  });

  it('status uses the display name; a state-only diff is named, and a deleted state falls back', async () => {
    const i = await make('names status');
    let v = (await patch(i.id, i.version, { status: 'in_progress' })).version;
    v = (await patch(i.id, v, { status: 'in_review' })).version;
    const s = await texts(i.id);
    expect(s).toContain('changed status from Backlog to In Progress');
    expect(s).toContain('changed status from In Progress to In Review');
    const st = await (await call(W.createState as Fn, seed.a.admin, 'POST', { name: 'Names Review', category: 'started' }, null, seed.a.slug, team)).json();
    const diff = JSON.stringify({ state_id: { before: null, after: st.id } });
    await asOwner(async (tx) => { await tx`insert into audit_events (id, workspace_id, actor_id, entity, entity_id, action, diff) values (${randomUUID()}, ${seed.a.id}, ${seed.a.member}, 'issue', ${i.id}, 'update', ${diff}::text::jsonb)`; });
    expect(await texts(i.id)).toContain('set state to Names Review');
    await asOwner(async (tx) => { await tx`delete from workflow_states where id = ${st.id}`; });
    expect(await texts(i.id)).toContain('set state to a deleted state');
    void v;
  });

  it('parent is shown as the issue identifier', async () => {
    const par = await make('names parent'); const kid = await make('names child');
    await patch(kid.id, kid.version, { parent_id: par.id });
    const ident = (await asOwner((tx) => tx`select t.key || '-' || i.number as n from issues i join teams t on t.id = i.team_id where i.id = ${par.id}`))[0]!.n as string;
    expect((await texts(kid.id))[0]).toBe(`set parent to ${ident}`);
  });

  it('raw ids stay in the structured changes for clients, never in the summary', async () => {
    const p = await mkProject('Raw Project'); const i = await make('names raw');
    await patch(i.id, i.version, { project_id: p.id });
    const it = (await feed(i.id)).find((x) => x.action === 'update')!;
    expect(it.changes[0]).toMatchObject({ field: 'project_id', after: p.id });
    expect(it.summary).toBe('set project to Raw Project');
  });
});
