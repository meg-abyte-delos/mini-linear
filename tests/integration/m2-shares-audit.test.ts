import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as S from "../../src/lib/resources/shares-audit";
import * as I from "../../src/lib/issues/handlers";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
(haveDb ? describe : describe.skip)("issue shares + audit list", () => {
  const owner = ownerSql(); let seed: Seed; let team = "", issue = "";
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    fn(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, "content-type": "application/json" } }), ...a);
  const send = (fn: Fn, user: string, method: string, b: unknown, ...a: string[]) => call(fn, user, { method, body: JSON.stringify(b) }, ...a);
  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    team = randomUUID();
    await owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`; });
    issue = (await (await send(I.createIssue as Fn, seed.a.member, "POST", { team_id: team, title: "s" }, seed.a.slug)).json()).id;
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("share: member shares with guest, guest sees it, revoke hides it, re-share works, guests/non-guests rejected", async () => {
    const g = seed.a.guest;
    expect((await call(I.getIssue as Fn, g, {}, seed.a.slug, issue)).status).toBe(404);
    expect((await send(S.shareIssue as Fn, g, "POST", { guest_user_id: g }, seed.a.slug, issue)).status).toBe(403);
    expect((await send(S.shareIssue as Fn, seed.a.member, "POST", { guest_user_id: seed.a.admin }, seed.a.slug, issue)).status).toBe(422);
    expect((await send(S.shareIssue as Fn, seed.a.member, "POST", { guest_user_id: seed.b.guest }, seed.a.slug, issue)).status).toBe(422); // other tenant's guest
    expect((await send(S.shareIssue as Fn, seed.a.member, "POST", { guest_user_id: g }, seed.a.slug, randomUUID())).status).toBe(404);
    expect((await send(S.shareIssue as Fn, seed.a.member, "POST", { guest_user_id: g }, seed.a.slug, issue)).status).toBe(201);
    expect((await send(S.shareIssue as Fn, seed.a.member, "POST", { guest_user_id: g }, seed.a.slug, issue)).status).toBe(200); // idempotent
    expect((await call(I.getIssue as Fn, g, {}, seed.a.slug, issue)).status).toBe(200);
    expect((await send(S.shareIssue as Fn, seed.b.member, "POST", { guest_user_id: g }, seed.a.slug, issue)).status).toBe(404); // non-member of A
    const del = (u: string) => call(S.unshareIssue as Fn, u, { method: "DELETE", q: `?guest_user_id=${g}` }, seed.a.slug, issue);
    expect((await del(g)).status).toBe(403);
    expect((await del(seed.a.member)).status).toBe(204);
    expect((await del(seed.a.member)).status).toBe(204);
    expect((await call(I.getIssue as Fn, g, {}, seed.a.slug, issue)).status).toBe(404);
    expect((await send(S.shareIssue as Fn, seed.a.admin, "POST", { guest_user_id: g }, seed.a.slug, issue)).status).toBe(201);
    expect((await call(I.getIssue as Fn, g, {}, seed.a.slug, issue)).status).toBe(200);
    const l = await (await call(S.listShares as Fn, seed.a.member, {}, seed.a.slug, issue)).json();
    expect(l.items).toHaveLength(1);
  });

  it("audit: admin+ only, newest first, filters, cursor, tenant-isolated, share events recorded", async () => {
    expect((await call(S.listAudit as Fn, seed.a.member, {}, seed.a.slug)).status).toBe(403);
    expect((await call(S.listAudit as Fn, seed.a.guest, {}, seed.a.slug)).status).toBe(403);
    const r = await call(S.listAudit as Fn, seed.a.admin, { q: `?entity=issue_share&entity_id=${issue}` }, seed.a.slug);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.items.map((e: { action: string }) => e.action)).toEqual(["create", "delete", "create"]);
    const p1 = await (await call(S.listAudit as Fn, seed.a.admin, { q: "?limit=2" }, seed.a.slug)).json();
    expect(p1.items).toHaveLength(2); expect(p1.next_cursor).toBeTruthy();
    const p2 = await (await call(S.listAudit as Fn, seed.a.admin, { q: `?limit=2&cursor=${p1.next_cursor}` }, seed.a.slug)).json();
    expect(p2.items[0].id < p1.items[1].id).toBe(true);
    expect((await call(S.listAudit as Fn, seed.a.admin, { q: `?cursor=${p1.next_cursor}` }, seed.b.slug)).status).toBe(404); // not B's member
    expect((await call(S.listAudit as Fn, seed.b.admin, { q: `?cursor=${p1.next_cursor}` }, seed.b.slug)).status).toBe(400); // cursor bound to workspace A
    const b = await (await call(S.listAudit as Fn, seed.b.admin, {}, seed.b.slug)).json();
    expect(b.items.every((e: { entity_id: string }) => e.entity_id !== issue)).toBe(true);
  });
});
