import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerSql, seedTwoWorkspaces, type Seed } from "../helpers/seed";
import { setSessionResolver, db } from "../../src/lib/http/ctx";
import * as H from "../../src/lib/issues/handlers";
import * as A from "../../src/lib/issues/activity-attachments";
import * as U from "../../src/lib/attachments/uploads";
import { fsStore, setAttachmentStore, storageKey } from "../../src/lib/attachments/store";

const haveDb = !!(process.env.DATABASE_URL && process.env.DATABASE_OWNER_URL);
if (process.env.CI && !haveDb) throw new Error("CI=true but DB urls unset: integration tests must not skip");
const PDF = "application/pdf";
const PNG = "\x89PNG\r\n\x1a\nxx";
(haveDb ? describe : describe.skip)("A8 attachments: uploads", () => {
  const owner = ownerSql(); let seed: Seed; let issue = "", other = "", dir = "";
  const asOwner = <T>(ws: string, f: (tx: import("postgres").TransactionSql) => Promise<T>) => owner.begin(async (tx) => { await tx`select set_config('app.workspace_id', ${ws}, true)`; return f(tx); }) as Promise<T>;
  const call = (fn: unknown, user: string, init: RequestInit & { q?: string } = {}, ...a: string[]) =>
    (fn as (r: Request, ...a: string[]) => Promise<Response>)(new Request(`http://x/api${init.q ?? ""}`, { ...init, headers: { "x-u": user, ...(init.headers as object) } }), ...a);
  const J = { "content-type": "application/json" };
  const init = (user: string, body: unknown, id = issue, slug = seed.a.slug) => call(U.createUpload, user, { method: "POST", headers: J, body: JSON.stringify(body) }, slug, id);
  const put = (user: string, aid: string, data: Uint8Array | string, headers: Record<string, string> = {}, id = issue) => {
    const buf = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    return call(U.putContent, user, { method: "PUT", headers: { "content-type": PDF, "content-length": String(buf.length), ...headers }, body: buf as unknown as BodyInit }, seed.a.slug, id, aid);
  };
  const get = (user: string, aid: string, q = "", headers: Record<string, string> = {}, id = issue) => call(U.getContent, user, { q, headers }, seed.a.slug, id, aid);
  const upload = async (user: string, data: string, mime = PDF, filename = "spec.pdf") => {
    const r = await init(user, { filename, mime_type: mime, size_bytes: Buffer.from(data, "latin1").length });
    expect(r.status).toBe(201);
    const j = await r.json();
    const p = await put(user, j.id, data, { "content-type": mime });
    return { init: j, put: p };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "att-"));
    setAttachmentStore(fsStore(dir));
    seed = await seedTwoWorkspaces(owner);
    setSessionResolver(async (r) => r.headers.get("x-u"));
    const team = randomUUID(), team2 = randomUUID();
    other = randomUUID();
    await asOwner(seed.a.id, async (tx) => {
      await tx`insert into teams (id, workspace_id, name, key) values (${team}, ${seed.a.id}, 'Eng', 'ATT'), (${team2}, ${seed.a.id}, 'Ops', 'OPS')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team}, ${seed.a.member})`;
      await tx`insert into users (id, email, password_hash, email_verified_at) values (${other}, ${'other-' + other + '@a.test'}, 'x', now())`;
      await tx`insert into memberships (id, workspace_id, user_id, role) values (${randomUUID()}, ${seed.a.id}, ${other}, 'member')`;
      await tx`insert into team_memberships (workspace_id, team_id, user_id) values (${seed.a.id}, ${team2}, ${other})`;
    });
    const r = await call(H.createIssue, seed.a.member, { method: "POST", headers: J, body: JSON.stringify({ team_id: team, title: "att" }) }, seed.a.slug);
    issue = (await r.json()).id;
  });
  afterAll(async () => { setAttachmentStore(undefined); await db().end(); await owner.end(); });

  it("round trip: bytes, sha256, DTO, list, content headers", async () => {
    const data = "%PDF-1.4 hello attachments";
    const { init: i, put: p } = await upload(seed.a.member, data);
    expect(i.upload_url).toMatch(new RegExp(`/api/v1/w/${seed.a.slug}/issues/${issue}/attachments/${i.id}/content$`));
    expect(Date.parse(i.expires_at)).toBeGreaterThan(Date.now());
    expect(p.status).toBe(200);
    const dto = await p.json();
    expect(dto).toMatchObject({ id: i.id, kind: "file", url: null, filename: "spec.pdf", title: "spec.pdf", mime_type: PDF, upload_status: "ready", size_bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"), download_url: `/api/v1/w/${seed.a.slug}/issues/${issue}/attachments/${i.id}/content` });
    const g = await get(seed.a.member, i.id);
    expect(g.status).toBe(200);
    expect(await g.text()).toBe(data);
    expect(g.headers.get("content-type")).toBe(PDF);
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    expect(g.headers.get("content-security-policy")).toBe("sandbox");
    expect(g.headers.get("cache-control")).toBe("private, max-age=0");
    expect(g.headers.get("content-disposition")).toBe(`attachment; filename="spec.pdf"; filename*=UTF-8''spec.pdf`);
    const list = await (await call(A.listAttachments, seed.a.member, {}, seed.a.slug, issue)).json();
    expect(list.items.find((x: { id: string }) => x.id === i.id)).toMatchObject({ upload_status: "ready", url: null });
    const act = await (await call(H.getIssue, seed.a.member, {}, seed.a.slug, issue)).status;
    expect(act).toBe(200);
  });

  it("Range requests and inline images", async () => {
    const { init: i } = await upload(seed.a.member, "%PDF-12345");
    const r = await get(seed.a.member, i.id, "", { range: "bytes=2-4" });
    expect(r.status).toBe(206); expect(r.headers.get("content-range")).toBe("bytes 2-4/10"); expect(await r.text()).toBe("DF-");
    expect(await (await get(seed.a.member, i.id, "", { range: "bytes=-3" })).text()).toBe("345");
    expect(await (await get(seed.a.member, i.id, "", { range: "bytes=7-" })).text()).toBe("345");
    expect((await get(seed.a.member, i.id, "", { range: "bytes=50-60" })).status).toBe(416);
    const png = await upload(seed.a.member, PNG, "image/png", "pic é.png");
    const g = await get(seed.a.member, png.init.id, "?inline=1");
    expect(g.headers.get("content-disposition")).toMatch(/^inline; filename="pic _.png"; filename\*=UTF-8''pic%20%C3%A9\.png$/);
    expect((await get(seed.a.member, i.id, "?inline=1")).headers.get("content-disposition")).toMatch(/^attachment/); // only images go inline
  });

  it("init validation: 413, 415 (svg, html), strict body, quota, bad filename", async () => {
    const ok = { filename: "a.pdf", mime_type: PDF, size_bytes: 3 };
    const big = await init(seed.a.member, { ...ok, size_bytes: 25 * 1024 * 1024 + 1 });
    expect(big.status).toBe(413); expect((await big.json()).error.code).toBe("payload_too_large");
    for (const m of ["image/svg+xml", "text/html", "application/x-msdownload"]) {
      const r = await init(seed.a.member, { ...ok, mime_type: m });
      expect(r.status).toBe(415); expect((await r.json()).error.code).toBe("unsupported_media_type");
    }
    for (const bad of [{ ...ok, extra: 1 }, { ...ok, size_bytes: -1 }, { ...ok, size_bytes: 1.5 }, { mime_type: PDF, size_bytes: 1 }, { ...ok, filename: ".." }, { ...ok, filename: "/" }])
      expect((await init(seed.a.member, bad)).status).toBe(422);
    expect((await init(seed.a.guest, ok)).status).toBe(403);
    expect((await init(seed.b.member, ok)).status).toBe(404);
    expect((await init(seed.a.member, ok, randomUUID())).status).toBe(404);
    expect((await init(other, ok)).status).toBe(404); // member of another team
  });

  it("workspace quota", async () => {
    const used = (await asOwner(seed.a.id, (tx) => tx`select coalesce(sum(size_bytes),0)::float8 as s from issue_attachments where storage_key is not null and deleted_at is null`))[0]!.s as number;
    const room = 200 * 1024 * 1024 - used;
    // reserve (without uploading) up to the cap in 25 MB steps, then one more byte-sized file must fail
    let left = room;
    while (left > 0) { const n = Math.min(left, 25 * 1024 * 1024); expect((await init(seed.a.member, { filename: "q.zip", mime_type: "application/zip", size_bytes: n })).status).toBe(201); left -= n; }
    const r = await init(seed.a.member, { filename: "q.zip", mime_type: "application/zip", size_bytes: 1 });
    expect(r.status).toBe(422); expect((await r.json()).error.message).toBe("workspace attachment quota exceeded");
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where upload_status = 'pending' and filename = 'q.zip'`);
  });

  it("PUT rules: second PUT 409, other user 403, size/type mismatch, svg", async () => {
    const r = await init(seed.a.member, { filename: "x.pdf", mime_type: PDF, size_bytes: 10 });
    const { id } = await r.json();
    expect((await put(seed.a.admin, id, "%PDF-12345")).status).toBe(403);
    expect((await put(seed.a.member, id, "%PDF-1234")).status).toBe(422); // Content-Length 9 != 10
    expect((await put(seed.a.member, id, "%PDF-12345", { "content-type": "image/png" })).status).toBe(415);
    expect((await put(seed.a.member, id, "%PDF-123456789", { "content-length": "10" })).status).toBe(422); // body longer than declared
    expect(existsSync(join(dir, storageKey(seed.a.id, id)))).toBe(false); // failed PUTs leave no bytes
    expect((await put(seed.a.member, id, "%PDF-12345")).status).toBe(200);
    const again = await put(seed.a.member, id, "%PDF-12345");
    expect(again.status).toBe(409); expect((await again.json()).error.code).toBe("conflict");
    expect((await put(seed.a.member, randomUUID(), "x")).status).toBe(404);
    expect((await put(seed.a.guest, id, "%PDF-12345")).status).toBe(403);
    expect((await put(seed.b.member, id, "%PDF-12345")).status).toBe(404);
    // declared svg never gets a row
    expect((await init(seed.a.member, { filename: "x.svg", mime_type: "image/svg+xml", size_bytes: 5 })).status).toBe(415);
  });

  it("pending is visible to its creator only; download visibility follows the issue", async () => {
    const { id } = await (await init(seed.a.member, { filename: "p.pdf", mime_type: PDF, size_bytes: 7 })).json();
    expect((await get(seed.a.admin, id)).status).toBe(404);
    expect((await get(seed.a.member, id)).status).toBe(404); // no bytes yet
    const lst = async (u: string) => (await (await call(A.listAttachments, u, {}, seed.a.slug, issue)).json()).items.find((x: { id: string }) => x.id === id);
    expect(await lst(seed.a.admin)).toBeUndefined();
    expect(await lst(seed.a.member)).toMatchObject({ upload_status: "pending", download_url: null });
    const { init: i } = await upload(seed.a.member, "%PDF-shared");
    expect((await get(seed.a.admin, i.id)).status).toBe(200);
    expect((await get(other, i.id)).status).toBe(404); // other team
    expect((await get(seed.b.member, i.id)).status).toBe(404);
    expect((await get(seed.a.guest, i.id)).status).toBe(404); // no share
    await asOwner(seed.a.id, (tx) => tx`insert into issue_shares (workspace_id, issue_id, guest_user_id, shared_by) values (${seed.a.id}, ${issue}, ${seed.a.guest}, ${seed.a.member})`);
    const gg = await get(seed.a.guest, i.id);
    expect(gg.status).toBe(200); expect(await gg.text()).toBe("%PDF-shared");
    expect((await call(A.deleteAttachment, seed.a.guest, { method: "DELETE" }, seed.a.slug, issue, i.id)).status).toBe(403);
    await asOwner(seed.a.id, (tx) => tx`update issue_shares set revoked_at = now() where issue_id = ${issue}`);
    expect((await get(seed.a.guest, i.id)).status).toBe(404);
  });

  it("delete matrix, soft delete, then GC removes row and bytes", async () => {
    const mk = async () => (await upload(seed.a.member, "%PDF-bye")).init.id as string;
    const del = (u: string, id: string) => call(A.deleteAttachment, u, { method: "DELETE" }, seed.a.slug, issue, id);
    const a = await mk();
    expect((await del(other, a)).status).toBe(404);
    expect((await del(seed.a.guest, a)).status).toBe(403);
    expect((await del(seed.a.member, a)).status).toBe(204);
    expect((await del(seed.a.member, a)).status).toBe(404);
    expect((await get(seed.a.member, a)).status).toBe(404);
    const b = await mk();
    expect((await del(seed.a.admin, b)).status).toBe(204); // admin may delete others'
    const key = storageKey(seed.a.id, a);
    expect(existsSync(join(dir, key))).toBe(true); // bytes stay until GC
    expect(await U.gcAttachments(db())).toBe(0); // too fresh
    await asOwner(seed.a.id, (tx) => tx`update issue_attachments set deleted_at = now() - interval '11 minutes' where id in (${a}, ${b})`);
    expect(await U.gcAttachments(db())).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(dir, key))).toBe(false);
    expect(await asOwner(seed.a.id, (tx) => tx`select 1 from issue_attachments where id in (${a}, ${b})`)).toHaveLength(0);
  });

  it("pending expiry: PUT after 1 h is 404 and GC removes the row", async () => {
    const { id } = await (await init(seed.a.member, { filename: "e.pdf", mime_type: PDF, size_bytes: 7 })).json();
    await asOwner(seed.a.id, (tx) => tx`update issue_attachments set created_at = now() - interval '61 minutes' where id = ${id}`);
    expect((await put(seed.a.member, id, "%PDF-ab")).status).toBe(404);
    expect(await U.gcAttachments(db())).toBeGreaterThanOrEqual(1);
    expect(await asOwner(seed.a.id, (tx) => tx`select 1 from issue_attachments where id = ${id}`)).toHaveLength(0);
  });

  it("path traversal in filename stays metadata; keys are server generated", async () => {
    const { init: i, put: p } = await upload(seed.a.member, "%PDF-", PDF, "../../etc/pass\u0000wd.pdf");
    expect(p.status).toBe(200);
    expect((await p.json()).filename).toBe("passwd.pdf");
    expect(existsSync(join(dir, storageKey(seed.a.id, i.id)))).toBe(true);
    expect(U.sanitizeFilename("C:\\temp\\a b.txt")).toBe("a b.txt");
    expect(() => U.sanitizeFilename("..")).toThrow();
    await expect(fsStore(dir).delete("../../etc/passwd")).rejects.toThrow();
  });

  it("RLS: another workspace sees no rows; links flow unchanged", async () => {
    expect(await asOwner(seed.b.id, (tx) => tx`select 1 from issue_attachments`)).toHaveLength(0);
    const r = await call(A.createAttachment, seed.a.member, { method: "POST", headers: J, body: JSON.stringify({ url: "https://github.com/acme/app/pull/7" }) }, seed.a.slug, issue);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ kind: "link", url: "https://github.com/acme/app/pull/7", upload_status: "ready", sha256: null, download_url: null, filename: null });
    const f = await call(A.createAttachment, seed.a.member, { method: "POST", headers: J, body: JSON.stringify({ kind: "file", url: "https://cdn.x.io/Spec%20v2.pdf", mime_type: PDF, size_bytes: 12 }) }, seed.a.slug, issue);
    expect(await f.json()).toMatchObject({ kind: "file", url: "https://cdn.x.io/Spec%20v2.pdf", download_url: null });
  });

  it("streaming cap: no Content-Length (chunked) and longer bodies abort without leaving a key; row stays pending and retryable", async () => {
    const { id } = await (await init(seed.a.member, { filename: "c.pdf", mime_type: PDF, size_bytes: 10 })).json();
    const stream = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
    const chunked = (parts: string[]) => (call(U.putContent, seed.a.member, { method: "PUT", headers: { "content-type": PDF }, body: stream(parts), duplex: "half" } as never, seed.a.slug, issue, id));
    const long = await chunked(["%PDF-", "123456789"]);
    expect(long.status).toBe(422);
    expect(existsSync(join(dir, storageKey(seed.a.id, id)))).toBe(false);
    expect((await chunked(["%PDF-", "12"])).status).toBe(422); // ends short
    expect((await asOwner(seed.a.id, (tx) => tx`select upload_status from issue_attachments where id = ${id}`))[0]!.upload_status).toBe("pending");
    const ok = await chunked(["%PD", "F-12", "345"]);
    expect(ok.status).toBe(200); // retry works, magic bytes split across chunks
  });

  it("magic bytes, mime parameters, content-type with params", async () => {
    const r = await init(seed.a.member, { filename: "m.png", mime_type: "IMAGE/PNG; charset=binary", size_bytes: 10 });
    expect(r.status).toBe(201);
    const { id } = await r.json();
    const bad = await put(seed.a.member, id, "not a png!", { "content-type": "image/png" });
    expect(bad.status).toBe(415); expect(existsSync(join(dir, storageKey(seed.a.id, id)))).toBe(false);
    const good = await put(seed.a.member, id, PNG, { "content-type": "Image/PNG; x=1" });
    expect(good.status).toBe(200); expect((await good.json()).mime_type).toBe("image/png");
    const txt = await upload(seed.a.member, "just text", "text/plain", "n.txt"); // no signature for text
    expect(txt.put.status).toBe(200);
    expect((await init(seed.a.member, { filename: "z.zip", mime_type: "application/zip", size_bytes: 4 })).status).toBe(201);
  });

  it("inline only for image/*; filename header injection", async () => {
    const pdf = await upload(seed.a.member, "%PDF-inl");
    expect((await get(seed.a.member, pdf.init.id, "?inline=1")).headers.get("content-disposition")).toMatch(/^attachment;/);
    const evil = await upload(seed.a.member, "%PDF-inj", PDF, 'a"\r\nX-Evil: 1\u00e9.pdf');
    const dto = await evil.put.json();
    expect(dto.filename).not.toMatch(/["\r\n]/);
    const h = (await get(seed.a.member, dto.id)).headers.get("content-disposition")!;
    expect(h).not.toMatch(/[\r\n]/); expect(h.split(";")[1]).toMatch(/^ filename="[\x20-\x7e]*"$/);
  });

  it("21st pending row per user is refused; concurrent POSTs near the quota cannot overshoot", async () => {
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where upload_status = 'pending'`);
    const mk = () => init(seed.a.admin, { filename: "p.zip", mime_type: "application/zip", size_bytes: 1 });
    for (let i = 0; i < 20; i++) expect((await mk()).status).toBe(201);
    const r = await mk(); expect(r.status).toBe(422);
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where upload_status = 'pending'`);
    const used = (await asOwner(seed.a.id, (tx) => tx`select coalesce(sum(size_bytes),0)::float8 as s from issue_attachments where storage_key is not null and deleted_at is null`))[0]!.s as number;
    let left = 200 * 1024 * 1024 - used - 2000;
    while (left > 0) { const n = Math.min(left, 25 * 1024 * 1024); expect((await init(seed.a.owner, { filename: "f.zip", mime_type: "application/zip", size_bytes: n })).status).toBe(201); left -= n; }
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where filename = 'p.zip'`);
    const users = [seed.a.member, seed.a.admin, seed.a.owner];
    const res = await Promise.all(users.map((u) => init(u, { filename: "r.zip", mime_type: "application/zip", size_bytes: 1000 })));
    expect(res.filter((x) => x.status === 201)).toHaveLength(2);
    expect(res.filter((x) => x.status === 422)).toHaveLength(1);
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where upload_status = 'pending'`);
  });

  it("orphan keys (rows gone by cascade) are removed by gcOrphanKeys", async () => {
    const { init: i } = await upload(seed.a.owner, "%PDF-orph");
    const key = join(dir, storageKey(seed.a.id, i.id));
    await asOwner(seed.a.id, (tx) => tx`delete from issue_attachments where id = ${i.id}`); // as the cascade would
    expect(existsSync(key)).toBe(true);
    expect(await U.gcOrphanKeys(db())).toBeGreaterThanOrEqual(1);
    expect(existsSync(key)).toBe(false);
  });

  it("a ready upload emits an update event on the parent issue", async () => {
    const before = await asOwner(seed.a.id, (tx) => tx`select coalesce(max(id),0)::int as m from sync_events`);
    await upload(seed.a.member, "%PDF-evt");
    const ev = await asOwner(seed.a.id, (tx) => tx`select entity, op, issue_id from sync_events where id > ${before[0]!.m} order by id`);
    expect(ev.at(-1)).toMatchObject({ entity: "issue", op: "update", issue_id: issue });
  });
});
