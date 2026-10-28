import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import { handleGithubWebhook, sign } from "../../src/lib/integrations/github";
import * as G from "../../src/lib/integrations/github-admin";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
const FIXTURE = readFileSync(new URL("../fixtures/github/pr-opened.json", import.meta.url), "utf8");

(haveDb ? describe : describe.skip)("A9 GitHub integration", () => {
  const owner = ownerSql(); let seed: Seed; let team = "", teamB = ""; const iss: Record<string, string> = {};
  type Fn = (r: Request, ...a: string[]) => Promise<Response>;
  const call = (fn: Fn, user: string, method = "GET", body?: unknown, q = "", ...a: string[]) =>
    fn(new Request(`http://x/api${q}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "x-u": user, "content-type": "application/json" } }), ...a);
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const hook = (conn: string, secret: string | null, payload: unknown, opts: { event?: string; delivery?: string; sig?: string } = {}) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const h: Record<string, string> = { "content-type": "application/json", "x-github-event": opts.event ?? "pull_request", "x-github-delivery": opts.delivery ?? randomUUID() };
    if (opts.sig ?? secret) h["x-hub-signature-256"] = opts.sig ?? sign(secret!, body);
    return handleGithubWebhook(new Request("http://x/hook", { method: "POST", body, headers: h }), conn);
  };
  const statusOf = (n: number) => asOwner(seed.a.id, async (tx) => (await tx`select status from issues where team_id = ${team} and number = ${n}`)[0]!.status as string);
  const pr = (o: Record<string, unknown>, action = "opened") => {
    const p = JSON.parse(FIXTURE); p.action = action; Object.assign(p.pull_request, o); return p;
  };
  let conn = "", secret = "";

  beforeAll(async () => {
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    team = randomUUID(); teamB = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ENG')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${seed.a.member})`;
      for (let n = 1; n <= 6; n++) {
        iss[n] = randomUUID();
        await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by, status) values (${iss[n]!}, ${seed.a.id}, ${team}, ${n}, ${"i" + n}, ${"a" + n}, ${seed.a.member}, ${n === 5 ? "canceled" : "todo"})`;
      }
    });
    await asOwner(seed.b.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${teamB}, ${seed.b.id}, 'Eng', 'ENG')`;
      await tx`insert into issues (id, workspace_id, team_id, number, title, sort_key, created_by) values (${randomUUID()}, ${seed.b.id}, ${teamB}, 1, 'b1', 'a1', ${seed.b.member})`;
    });
  });
  afterAll(async () => { await db().end(); await owner.end(); });

  it("connection: admin-only PUT returns the secret once; GET never exposes it; app_user cannot SELECT it", async () => {
    expect((await call(G.putGithubConnection as Fn, seed.a.member, "PUT", {}, "", seed.a.slug)).status).toBe(403);
    expect(await (await call(G.getGithubConnection as Fn, seed.a.member, "GET", undefined, "", seed.a.slug)).json()).toEqual({ connected: false });
    const r = await call(G.putGithubConnection as Fn, seed.a.admin, "PUT", {}, "", seed.a.slug);
    expect(r.status).toBe(201);
    const j = await r.json(); conn = j.id; secret = j.webhook_secret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/); expect(j.webhook_path).toBe(`/api/v1/integrations/github/webhook/${conn}`);
    const g = await (await call(G.getGithubConnection as Fn, seed.a.member, "GET", undefined, "", seed.a.slug)).json();
    expect(g.connected).toBe(true); expect(JSON.stringify(g)).not.toContain(secret);
    await expect(db().begin(async (tx) => { await tx`select set_config('app.workspace_id', ${seed.a.id}, true)`; return tx`select webhook_secret from github_connections`; })).rejects.toThrow(/permission denied/);
  });

  it("webhook: bad / missing signature, unknown connection, wrong tenant secret -> 401, nothing stored", async () => {
    const p = pr({});
    expect((await hook(conn, null, p)).status).toBe(401);
    expect((await hook(conn, "wrong".repeat(10), p)).status).toBe(401);
    expect((await hook(randomUUID(), secret, p)).status).toBe(401);
    expect((await hook("not-a-uuid", secret, p)).status).toBe(401);
    expect((await hook(conn, null, JSON.stringify(p), { sig: sign(secret, JSON.stringify(p) + "x") })).status).toBe(401);
    expect(await asOwner(seed.a.id, (tx) => tx`select 1 from issue_pr_links`)).toHaveLength(0);
    expect(await statusOf(1)).toBe("todo");
  });

  it("ping is accepted; unrelated events ignored", async () => {
    expect((await hook(conn, secret, { zen: "hi" }, { event: "ping" })).status).toBe(200);
    expect((await hook(conn, secret, { action: "created" }, { event: "issue_comment" })).status).toBe(202);
  });

  it("PR opened (signed fixture): links branch + magic word + mention; moves only closing refs to In Progress", async () => {
    const body = FIXTURE; // exact fixture bytes, signed
    const r = await handleGithubWebhook(new Request("http://x/hook", { method: "POST", body, headers: { "x-github-event": "pull_request", "x-github-delivery": "d-1", "x-hub-signature-256": sign(secret, body) } }), conn);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.linked.sort()).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
    expect(await statusOf(1)).toBe("in_progress"); expect(await statusOf(2)).toBe("in_progress"); expect(await statusOf(3)).toBe("todo");
    const links = await asOwner(seed.a.id, (tx) => tx`select issue_id, linked_via, closes, state from issue_pr_links where pr_number = 42 order by linked_via`);
    expect(links.map((l) => [l.linked_via, l.closes, l.state])).toEqual([["branch", true, "open"], ["magic_word", true, "open"], ["mention", false, "open"]]);
    const audits = await asOwner(seed.a.id, (tx) => tx`select actor_id, action from audit_events where entity_id = ${iss[1]!}`);
    expect(audits).toEqual([{ actor_id: null, action: "github_automation" }]);
    // replayed delivery is a no-op
    const again = await handleGithubWebhook(new Request("http://x/hook", { method: "POST", body, headers: { "x-github-event": "pull_request", "x-github-delivery": "d-1", "x-hub-signature-256": sign(secret, body) } }), conn);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
  });

  it("links visible to team members, hidden from guests without share and other tenants", async () => {
    const m = await (await call(G.listIssuePrLinks as Fn, seed.a.member, "GET", undefined, `?issue_id=${iss[1]}`, seed.a.slug)).json();
    expect(m.items).toHaveLength(1); expect(m.items[0]).toMatchObject({ repo_full_name: "acme/web", pr_number: 42, state: "open" });
    expect((await (await call(G.listIssuePrLinks as Fn, seed.a.guest, "GET", undefined, `?issue_id=${iss[1]}`, seed.a.slug)).json()).items).toHaveLength(0);
    expect((await (await call(G.listIssuePrLinks as Fn, seed.b.admin, "GET", undefined, `?issue_id=${iss[1]}`, seed.b.slug)).json()).items).toHaveLength(0);
  });

  it("edited: removed magic word unlinks; merged -> Done; canceled never moves; workspace B untouched", async () => {
    expect((await hook(conn, secret, pr({ body: "no refs anymore" }, "edited"))).status).toBe(200);
    const l = await asOwner(seed.a.id, (tx) => tx`select issue_id from issue_pr_links where pr_number = 42`);
    expect(l.map((x) => x.issue_id)).toEqual([iss[1]]); // branch link stays
    const r = await hook(conn, secret, pr({ state: "closed", merged: true, body: "Closes ENG-5" }, "closed"));
    expect((await r.json()).moved).toEqual([{ issue: "ENG-1", from: "in_progress", to: "done" }]);
    expect(await statusOf(1)).toBe("done"); expect(await statusOf(5)).toBe("canceled");
    expect((await asOwner(seed.b.id, (tx) => tx`select status from issues`))[0]!.status).toBe("backlog");
    expect(await asOwner(seed.b.id, (tx) => tx`select 1 from issue_pr_links`)).toHaveLength(0);
  });

  it("draft PR links without moving; closed unmerged does not complete", async () => {
    await hook(conn, secret, pr({ number: 50, html_url: "https://github.com/acme/web/pull/50", draft: true, head: { ref: "eng-4-x" }, body: "" }));
    expect(await statusOf(4)).toBe("todo");
    await hook(conn, secret, pr({ number: 50, html_url: "https://github.com/acme/web/pull/50", state: "closed", merged: false, head: { ref: "eng-4-x" }, body: "" }, "closed"));
    expect(await statusOf(4)).toBe("todo");
    expect((await asOwner(seed.a.id, (tx) => tx`select state from issue_pr_links where pr_number = 50`))[0]!.state).toBe("closed");
  });

  it("per-team settings: admin-only, validated, disabling open automation and custom merge state", async () => {
    const d = await (await call(G.getTeamGithubSettings as Fn, seed.a.member, "GET", undefined, "", seed.a.slug, team)).json();
    expect(d).toMatchObject({ on_pr_open: "in_progress", on_pr_review: "in_review", on_pr_merge: "done" });
    expect((await call(G.putTeamGithubSettings as Fn, seed.a.member, "PUT", { on_pr_open: null }, "", seed.a.slug, team)).status).toBe(403);
    expect((await call(G.putTeamGithubSettings as Fn, seed.a.admin, "PUT", { on_pr_open: "nope" }, "", seed.a.slug, team)).status).toBe(422);
    expect((await call(G.putTeamGithubSettings as Fn, seed.b.admin, "PUT", { on_pr_open: null }, "", seed.b.slug, team)).status).toBe(404);
    const ok = await call(G.putTeamGithubSettings as Fn, seed.a.admin, "PUT", { on_pr_open: null, on_pr_merge: "in_review" }, "", seed.a.slug, team);
    expect(await ok.json()).toMatchObject({ on_pr_open: null, on_pr_review: "in_review", on_pr_merge: "in_review" });
    await hook(conn, secret, pr({ number: 60, html_url: "https://github.com/acme/web/pull/60", head: { ref: "eng-6" }, body: "" }));
    expect(await statusOf(6)).toBe("todo");
    await hook(conn, secret, pr({ number: 60, html_url: "https://github.com/acme/web/pull/60", state: "closed", merged: true, head: { ref: "eng-6" }, body: "" }, "closed"));
    expect(await statusOf(6)).toBe("in_review");
  });

  it("rotation invalidates the old secret; delete disconnects", async () => {
    const r = await (await call(G.putGithubConnection as Fn, seed.a.admin, "PUT", {}, "", seed.a.slug)).json();
    expect(r.id).toBe(conn); expect(r.webhook_secret).not.toBe(secret);
    expect((await hook(conn, secret, { zen: 1 }, { event: "ping" })).status).toBe(401);
    expect((await hook(conn, r.webhook_secret, { zen: 1 }, { event: "ping" })).status).toBe(200);
    expect((await call(G.deleteGithubConnection as Fn, seed.a.admin, "DELETE", undefined, "", seed.a.slug)).status).toBe(204);
    expect((await hook(conn, r.webhook_secret, { zen: 1 }, { event: "ping" })).status).toBe(401);
  });
});
