// Area 9 Part 2: team estimate settings, label groups and team labels.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as S from "../../src/lib/resources/team-settings";
import * as L from "../../src/lib/resources/labels-cycles";
import * as T from "../../src/lib/resources/tenancy";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("A9.2 team settings and labels", () => {
  const owner = ownerSql(); let seed: Seed; let teamA = "", teamA2 = "", teamB = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit = {}, ...a: string[]) =>
    fn(new Request("http://x/api", { ...init, headers: { "x-u": user, "content-type": "application/json", ...(init.headers as object) } }), ...a);
  const send = (fn: Fn, user: string, method: string, body: unknown, ver: number | null, ...a: string[]) =>
    call(fn, user, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: ver === null ? {} : { "if-match": `"${ver}"` } }, ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    teamA = randomUUID(); teamA2 = randomUUID(); teamB = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamA}, ${seed.a.id}, 'Eng', 'ENG'), (${teamA2}, ${seed.a.id}, 'Ops', 'OPS')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${teamA}, ${seed.a.member})`;
    });
    await asOwner(seed.b.id, (tx) => tx`insert into teams (id, workspace_id, name, key) values (${teamB}, ${seed.b.id}, 'Eng', 'ENG')`);
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("new teams get default settings (also via the API)", async () => {
    const r = await call(S.getSettings as Fn, seed.a.member, {}, seed.a.slug, teamA);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estimate_scale: "none", estimate_allow_zero: false, version: 1 });
    const c = await send(T.createTeam as Fn, seed.a.admin, "POST", { name: "Design", key: "DES" }, null, seed.a.slug);
    expect(c.status).toBe(201);
    const st = await call(S.getSettings as Fn, seed.a.admin, {}, seed.a.slug, (await c.json()).id);
    expect(st.status).toBe(200);
    expect(await st.json()).toMatchObject({ estimate_scale: "none", version: 1 });
  });

  it("visibility: non-member of the team, guest and other tenant get 404", async () => {
    expect((await call(S.getSettings as Fn, seed.a.member, {}, seed.a.slug, teamA2)).status).toBe(404);
    expect((await call(S.getSettings as Fn, seed.a.guest, {}, seed.a.slug, teamA)).status).toBe(404);
    expect((await call(S.getSettings as Fn, seed.b.owner, {}, seed.b.slug, teamA)).status).toBe(404);
    expect((await call(S.getSettings as Fn, seed.a.member, {}, seed.a.slug, "nope")).status).toBe(404);
  });

  it("settings: estimates, validation, If-Match, team admin only (cycle config is not here)", async () => {
    expect((await send(S.patchSettings as Fn, seed.a.member, "PATCH", { estimate_scale: "fibonacci" }, 1, seed.a.slug, teamA)).status).toBe(403);
    expect((await send(S.patchSettings as Fn, seed.a.admin, "PATCH", { estimate_scale: "weird" }, 1, seed.a.slug, teamA)).status).toBe(422);
    expect((await send(S.patchSettings as Fn, seed.a.admin, "PATCH", { cycles_enabled: true }, 1, seed.a.slug, teamA)).status).toBe(422);
    expect((await send(S.patchSettings as Fn, seed.a.admin, "PATCH", { estimate_allow_zero: true }, null, seed.a.slug, teamA)).status).toBe(428);
    const r = await send(S.patchSettings as Fn, seed.a.admin, "PATCH", { estimate_scale: "tshirt", estimate_allow_zero: true }, 1, seed.a.slug, teamA);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ estimate_scale: "tshirt", estimate_allow_zero: true, version: 2 });
    expect((await send(S.patchSettings as Fn, seed.a.admin, "PATCH", { estimate_allow_zero: false }, 1, seed.a.slug, teamA)).status).toBe(412);
    // a team admin (team role) may edit, a plain member may not
    await asOwner(seed.a.id, (tx) => tx`update team_memberships set role = 'admin' where team_id = ${teamA} and user_id = ${seed.a.member}`);
    expect((await send(S.patchSettings as Fn, seed.a.member, "PATCH", { estimate_scale: "linear" }, 2, seed.a.slug, teamA)).status).toBe(200);
    await asOwner(seed.a.id, (tx) => tx`update team_memberships set role = 'member' where team_id = ${teamA} and user_id = ${seed.a.member}`);
  });

  it("label groups + team labels: scope, permissions, uniqueness per scope, group/team consistency, visibility", async () => {
    expect((await send(S.createGroup as Fn, seed.a.member, "POST", { name: "Type" }, null, seed.a.slug)).status).toBe(403);
    const wg = await (await send(S.createGroup as Fn, seed.a.admin, "POST", { name: "Type", color: "#aa0000" }, null, seed.a.slug)).json();
    const tg = await (await send(S.createGroup as Fn, seed.a.admin, "POST", { name: "Area", team_id: teamA2 }, null, seed.a.slug)).json();
    expect(tg.team_id).toBe(teamA2);
    // team group / team label writes need a team admin: a plain team member gets 403, workspace labels stay open to members
    expect((await send(S.createGroup as Fn, seed.a.member, "POST", { name: "Mine", team_id: teamA }, null, seed.a.slug)).status).toBe(403);
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "Perf", group_id: wg.id }, null, seed.a.slug)).status).toBe(201);
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "Perf", team_id: teamA }, null, seed.a.slug)).status).toBe(403);
    const tl = await send(L.createLabel as Fn, seed.a.admin, "POST", { name: "Perf", team_id: teamA }, null, seed.a.slug);
    expect(tl.status).toBe(201); expect((await tl.json()).team_id).toBe(teamA);
    expect((await send(L.createLabel as Fn, seed.a.admin, "POST", { name: "perf", team_id: teamA }, null, seed.a.slug)).status).toBe(409);
    // member cannot create a label in a team they do not belong to, nor see that team's group
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "Ops", team_id: teamA2 }, null, seed.a.slug)).status).toBe(422);
    expect((await send(L.createLabel as Fn, seed.a.member, "POST", { name: "G", group_id: tg.id }, null, seed.a.slug)).status).toBe(422);
    // team group can only hold that team's labels (DB trigger), even for an admin
    expect((await send(L.createLabel as Fn, seed.a.admin, "POST", { name: "G", team_id: teamA, group_id: tg.id }, null, seed.a.slug)).status).toBe(422);
    const okTeamLabel = await send(L.createLabel as Fn, seed.a.admin, "POST", { name: "G", team_id: teamA2, group_id: tg.id }, null, seed.a.slug);
    expect(okTeamLabel.status).toBe(201);
    const hidden = (await okTeamLabel.json()).id;
    expect((await call(L.getLabelH as Fn, seed.a.member, {}, seed.a.slug, hidden)).status).toBe(404);
    const ml = (await (await call(L.listLabels as Fn, seed.a.member, {}, seed.a.slug)).json()).items as { id: string }[];
    expect(ml.some((l) => l.id === hidden)).toBe(false);
    const groups = (await (await call(S.listGroups as Fn, seed.a.member, {}, seed.a.slug)).json()).items as { id: string }[];
    expect(groups.map((g) => g.id)).toEqual([wg.id]);
    // deleting a group ungroups its labels
    expect((await send(S.deleteGroup as Fn, seed.a.admin, "DELETE", undefined, 1, seed.a.slug, tg.id)).status).toBe(204);
    expect((await (await call(L.getLabelH as Fn, seed.a.admin, {}, seed.a.slug, hidden)).json()).group_id).toBeNull();
    // other tenant cannot see group
    expect((await call(S.getGroupH as Fn, seed.b.owner, {}, seed.b.slug, wg.id)).status).toBe(404);
    const pg = await send(S.patchGroup as Fn, seed.a.admin, "PATCH", { name: "Kind" }, 1, seed.a.slug, wg.id);
    expect(pg.status).toBe(200); expect((await pg.json()).name).toBe("Kind");
  });

  it("issue_labels: an issue only takes workspace-level labels or labels of its own team (DB check)", async () => {
    const [wl, la, lb] = [randomUUID(), randomUUID(), randomUUID()], issue = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into labels (id, workspace_id, name) values (${wl}, ${seed.a.id}, 'ws-wide')`;
      await tx`insert into labels (id, workspace_id, name, team_id) values (${la}, ${seed.a.id}, 'a-only', ${teamA}), (${lb}, ${seed.a.id}, 'a2-only', ${teamA2})`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values (${issue}, ${seed.a.id}, ${teamA}, 9001, 't', 'a0', ${seed.a.member})`;
      await tx`insert into issue_labels (workspace_id, issue_id, label_id) values (${seed.a.id}, ${issue}, ${wl}), (${seed.a.id}, ${issue}, ${la})`;
    });
    await expect(asOwner(seed.a.id, (tx) => tx`insert into issue_labels (workspace_id, issue_id, label_id) values (${seed.a.id}, ${issue}, ${lb})`)).rejects.toThrow(/another team/);
  });
});
