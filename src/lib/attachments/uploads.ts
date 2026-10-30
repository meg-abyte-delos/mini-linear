import { z } from "zod";
import type postgres from "postgres";
import { withWorkspaceCtx, requireRole, db } from "../http/ctx";
import { ApiError, errorResponse } from "../http/errors";
import { parseId, parseJson } from "../http/validate";
import { diffOf } from "../audit";
import { uuidv7 } from "../uuid7";
import { load } from "../issues/handlers";
import { ATSEL, ATT_F, attDto, audit } from "../issues/activity-attachments";
import { attachmentStore, storageKey, SizeMismatch, type AttachmentStore } from "./store";
import { emitAttachmentEvent } from "./events";

type Row = Record<string, unknown>;
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const maxBytes = () => num(process.env.ATTACHMENT_MAX_BYTES, 25 * 1024 * 1024);
const quotaBytes = () => num(process.env.ATTACHMENT_WORKSPACE_QUOTA, 200 * 1024 * 1024);
export const MAX_PENDING = 20;
export const PENDING_TTL_MS = 60 * 60 * 1000;

/** svg and html are deliberately absent (script risk). */
export const MIME_ALLOWLIST = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/zip", "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const ZIPISH = new Set(["application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
/** First-16-bytes signature check for the binary types; text/json/csv/markdown have none. */
export function magicOk(mime: string, h: Uint8Array): boolean {
  if (mime === "image/png") return startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mime === "image/jpeg") return startsWith(h, [0xff, 0xd8, 0xff]);
  if (mime === "image/gif") return startsWith(h, ascii("GIF87a")) || startsWith(h, ascii("GIF89a"));
  if (mime === "image/webp") return startsWith(h, ascii("RIFF")) && startsWith(h, ascii("WEBP"), 8);
  if (mime === "application/pdf") return startsWith(h, ascii("%PDF-"));
  if (ZIPISH.has(mime)) return startsWith(h, [0x50, 0x4b, 0x03, 0x04]) || startsWith(h, [0x50, 0x4b, 0x05, 0x06]);
  return true;
}
/** Passes the stream through after checking its first 16 bytes against the declared mime (415 on mismatch). */
function magicGuard(mime: string): TransformStream<Uint8Array, Uint8Array> {
  let head = new Uint8Array(0), checked = false; const held: Uint8Array[] = [];
  const check = (c: TransformStreamDefaultController<Uint8Array>) => {
    checked = true;
    if (!magicOk(mime, head)) throw new ApiError("unsupported_media_type", "file content does not match the declared mime_type");
    for (const h of held) c.enqueue(h);
  };
  return new TransformStream({
    transform(chunk, c) {
      if (checked) return c.enqueue(chunk);
      held.push(chunk); const n = new Uint8Array(head.length + chunk.length); n.set(head); n.set(chunk, head.length); head = n;
      if (head.length >= 16) check(c);
    },
    flush(c) { if (!checked) check(c); },
  });
}
const INLINE_OK = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Metadata only: no path separators, no control chars, never "." / "..". */
export function sanitizeFilename(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const parts = raw.replace(/[\u0000-\u001f\u007f\u0080-\u009f"\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "").split(/[\\/]+/).map((p) => p.trim()).filter(Boolean);
  const name = (parts[parts.length - 1] ?? "").slice(0, 255);
  if (!name || /^\.+$/.test(name)) throw new ApiError("validation_failed", "filename is not valid");
  return name;
}

const initBody = z.object({
  filename: z.string().min(1).max(1024), mime_type: z.string().max(255), size_bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(255).optional(),
}).strict();

const base = (slug: string, issueId: string, id: string) => `/api/v1/w/${slug}/issues/${issueId}/attachments/${id}/content`;

/** POST /issues/:id/attachments/uploads: reserve a pending row and hand back the PUT url. */
export const createUpload = (req: Request, slug: string, rawIssue: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "member");
  const issueId = parseId(rawIssue), b = await parseJson(req, initBody);
  await load(ctx, issueId);
  const mime = b.mime_type.split(";")[0]!.trim().toLowerCase(), filename = sanitizeFilename(b.filename);
  if (!MIME_ALLOWLIST.has(mime)) throw new ApiError("unsupported_media_type", `mime type ${mime} is not allowed`);
  if (b.size_bytes > maxBytes()) throw new ApiError("payload_too_large", `file exceeds ${maxBytes()} bytes`);
  // Serialise quota checks of one workspace so two parallel reservations cannot both fit the last bytes.
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${ctx.workspaceId}))`;
  const n = await ctx.tx`select count(*)::int as n from issue_attachments where issue_id = ${issueId} and deleted_at is null`;
  if ((n[0]!.n as number) >= 500) throw new ApiError("validation_failed", "too many attachments on this issue (max 500)");
  const pend = await ctx.tx`select count(*)::int as n from issue_attachments where created_by = ${ctx.userId} and upload_status in ('pending','uploading') and deleted_at is null and created_at > now() - interval '1 hour'`;
  if ((pend[0]!.n as number) >= MAX_PENDING) throw new ApiError("validation_failed", `too many pending uploads (max ${MAX_PENDING})`);
  const used = await ctx.tx`select coalesce(sum(size_bytes), 0)::float8 as s from issue_attachments where storage_key is not null and deleted_at is null`;
  if ((used[0]!.s as number) + b.size_bytes > quotaBytes()) throw new ApiError("validation_failed", "workspace attachment quota exceeded");
  const id = uuidv7();
  await ctx.tx`insert into issue_attachments (id, workspace_id, issue_id, kind, url, title, mime_type, size_bytes, filename, storage_key, upload_status, created_by)
    values (${id}, ${ctx.workspaceId}, ${issueId}, 'file', null, ${b.title ?? filename}, ${mime}, ${b.size_bytes}, ${filename}, ${storageKey(ctx.workspaceId, id)}, 'pending', ${ctx.userId})`;
  const upload_url = base(slug, issueId, id);
  return Response.json({ id, upload_url, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() }, { status: 201, headers: { Location: upload_url } });
});

const maxPuts = () => num(process.env.ATTACHMENT_MAX_CONCURRENT_PUTS, 8);
const IDLE_MS = () => num(process.env.ATTACHMENT_IDLE_TIMEOUT_MS, 30_000);
const TOTAL_MS = () => num(process.env.ATTACHMENT_TOTAL_TIMEOUT_MS, 10 * 60_000);
const perUserPuts = () => num(process.env.ATTACHMENT_MAX_CONCURRENT_PUTS_PER_USER, 2);
let inflight = 0;
const byUser = new Map<string, number>(); // in-flight PUTs per user in this process: one member cannot occupy every slot
export const inflightPuts = () => inflight;
export const inflightPutsFor = (userId: string) => byUser.get(userId) ?? 0;

/** Wraps a request body: a read that stalls for `idleMs`, or a transfer longer than `totalMs`, errors the stream (the upload is then aborted and released). */
export function timedBody(body: ReadableStream<Uint8Array>, idleMs: number, totalMs: number): ReadableStream<Uint8Array> {
  const reader = body.getReader(), deadline = Date.now() + totalMs;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const wait = Math.min(idleMs, deadline - Date.now());
      let t: ReturnType<typeof setTimeout> | undefined;
      const stall = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ApiError("bad_request", wait < idleMs || Date.now() >= deadline ? "upload took too long" : "upload stalled")), Math.max(wait, 1)); });
      try {
        const r = await Promise.race([reader.read(), stall]);
        if (r.done) c.close(); else c.enqueue(r.value);
      } catch (e) { void reader.cancel().catch(() => {}); c.error(e); } finally { clearTimeout(t); }
    },
    cancel(r) { return reader.cancel(r); },
  });
}

type Claim = { key: string; size: number; mime: string; issueId: string };

/**
 * PUT .../attachments/:aid/content: the creator streams the bytes once; the row becomes ready.
 * Three phases so no database connection or row lock is held while the client is uploading:
 *  1. short tx: validate, then claim the row (pending -> uploading, conditional UPDATE: a second PUT loses with 409);
 *  2. no tx: stream to the store (byte cap, magic bytes, idle/total timeout), at most ATTACHMENT_MAX_CONCURRENT_PUTS (8) at once per process;
 *  3. short tx: finalize (ready, sha256, audit, sync event). On any failure the partial bytes are removed and the row goes back to pending (retryable).
 * The three transactions use the original request (rawReq): it is only read for its headers, and its body is never cloned/buffered.
 */
export async function putContent(req: Request, slug: string, rawIssue: string, rawId: string): Promise<Response> {
  if (inflight >= maxPuts()) return errorResponse(new ApiError("rate_limited", "too many uploads in progress, retry shortly"));
  inflight++;
  let counted: string | undefined;
  try {
    let claim: Claim | undefined;
    const first = await withWorkspaceCtx(req, slug, async (ctx) => {
      requireRole(ctx, "member");
      if (!counted) { // withWorkspaceCtx may replay this callback (40P01): count the PUT once, or the single decrement in finally leaks a slot
        if ((byUser.get(ctx.userId) ?? 0) >= perUserPuts()) throw new ApiError("rate_limited", "too many uploads in progress for this user, retry shortly");
        byUser.set(ctx.userId, (byUser.get(ctx.userId) ?? 0) + 1); counted = ctx.userId; // check and increment are synchronous: no race between PUTs
      }
      const issueId = parseId(rawIssue), id = parseId(rawId);
      await load(ctx, issueId);
      const rows = await ctx.tx<Row[]>`select storage_key, upload_status, mime_type, size_bytes, created_by, extract(epoch from now() - created_at) * 1000 as age_ms
        from issue_attachments where id = ${id} and issue_id = ${issueId} and storage_key is not null and deleted_at is null`;
      const row = rows[0];
      if (!row) throw new ApiError("not_found");
      if (row.created_by !== ctx.userId) throw new ApiError("forbidden", "only the uploader can send the content");
      if (row.upload_status !== "pending") throw new ApiError("conflict", "content already uploaded");
      if ((row.age_ms as number) > PENDING_TTL_MS) throw new ApiError("not_found", "upload expired");
      const ctype = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (ctype !== row.mime_type) throw new ApiError("unsupported_media_type", "Content-Type must equal the declared mime_type");
      const size = Number(row.size_bytes), cl = req.headers.get("content-length");
      if (cl !== null && Number(cl) > maxBytes()) throw new ApiError("payload_too_large", "body exceeds the maximum file size");
      if (cl !== null && Number(cl) !== size) throw new ApiError("validation_failed", "Content-Length must equal the declared size_bytes");
      if (!req.body && size !== 0) throw new ApiError("validation_failed", "empty body");
      const got = await ctx.tx`update issue_attachments set upload_status = 'uploading', upload_started_at = now()
        where id = ${id} and upload_status = 'pending' and deleted_at is null returning id`;
      if (got.length === 0) throw new ApiError("conflict", "content already uploaded");
      claim = { key: row.storage_key as string, size, mime: ctype, issueId };
      return new Response(null, { status: 204 });
    }, db(), { rawReq: true });
    if (!claim) return first;
    const { key, size, mime, issueId } = claim, id = parseId(rawId), store = attachmentStore();

    // Phase 2: stream, no transaction.
    let res;
    try {
      const body = timedBody(req.body ?? new Blob([]).stream(), IDLE_MS(), TOTAL_MS());
      res = await store.put(key, body.pipeThrough(magicGuard(mime)), { size: Math.min(size, maxBytes()), mime });
    } catch (e) {
      await store.delete(key).catch(() => {});
      await release(req, slug, id);
      if (e instanceof SizeMismatch) return errorResponse(new ApiError("validation_failed", "body length does not match the declared size_bytes"));
      return errorResponse(e);
    }

    // Phase 3: finalize.
    const done = await withWorkspaceCtx(req, slug, async (ctx) => {
      const issue = await load(ctx, issueId); // gone or hidden meanwhile: 404 and the bytes are removed below
      const upd = await ctx.tx`update issue_attachments set upload_status = 'ready', sha256 = ${res.sha256}, size_bytes = ${res.size}
        where id = ${id} and upload_status = 'uploading' and deleted_at is null returning id`;
      if (upd.length === 0) throw new ApiError("not_found"); // deleted while uploading
      const dto = attDto((await ctx.tx<Row[]>`${ATSEL(ctx)} where id = ${id}`)[0]!, slug);
      await audit(ctx, "attachment", id, "create", { ...diffOf(null, dto, ATT_F), issue_id: { before: null, after: issueId } });
      await emitAttachmentEvent(ctx, issueId, Number(issue.version));
      return Response.json(dto);
    }, db(), { rawReq: true });
    if (!done.ok) { await store.delete(key).catch(() => {}); await release(req, slug, id); }
    return done;
  } finally {
    inflight--;
    if (counted) { const n = (byUser.get(counted) ?? 1) - 1; if (n <= 0) byUser.delete(counted); else byUser.set(counted, n); }
  }
}

/** Puts a claimed row back to pending after a failed transfer (best effort: the GC reclaims a stuck 'uploading' row after 15 min). */
async function release(req: Request, slug: string, id: string): Promise<void> {
  await withWorkspaceCtx(req, slug, async (ctx) => {
    await ctx.tx`update issue_attachments set upload_status = 'pending', upload_started_at = null where id = ${id} and upload_status = 'uploading'`;
    return new Response(null, { status: 204 });
  }, db(), { rawReq: true }).catch(() => {});
}

const rfc5987 = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const asciiName = (s: string) => s.replace(/[^\x20-\x7e]|["\\%]/g, "_");
function parseRange(h: string, size: number): { start: number; end: number } | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number, end: number;
  if (m[1] === "") { const n = Number(m[2]); if (n === 0) return "invalid"; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (size === 0 || start >= size || start > end) return "invalid";
  return { start, end };
}

/** GET .../attachments/:aid/content: visibility is the issue's (guest with an active share included). */
export const getContent = (req: Request, slug: string, rawIssue: string, rawId: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const issueId = parseId(rawIssue), id = parseId(rawId);
  await load(ctx, issueId);
  const rows = await ctx.tx<Row[]>`select id, storage_key, upload_status, mime_type, size_bytes, filename, title, created_by from issue_attachments
    where id = ${id} and issue_id = ${issueId} and storage_key is not null and deleted_at is null`;
  const row = rows[0];
  if (!row || (row.upload_status !== "ready" && row.created_by !== ctx.userId)) throw new ApiError("not_found");
  const size = Number(row.size_bytes), mime = row.mime_type as string;
  const rh = req.headers.get("range"), range = rh ? parseRange(rh, size) : null;
  if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const got = await attachmentStore().get(row.storage_key as string, range ?? undefined);
  if (!got) throw new ApiError("not_found");
  const name = (row.filename as string | null) ?? (row.title as string);
  const inline = new URL(req.url).searchParams.get("inline") === "1" && INLINE_OK.has(mime);
  const headers: Record<string, string> = {
    "Content-Type": mime, "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName(name)}"; filename*=UTF-8''${rfc5987(name)}`,
    "Cache-Control": "private, max-age=0", "Content-Security-Policy": "sandbox",
    "Content-Length": String(range ? range.end - range.start + 1 : size),
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(got.stream, { status: range ? 206 : 200, headers });
});

/** Removes pending uploads older than 1 h and soft-deleted rows older than 10 min, and their bytes. Returns the number of rows removed. */
export async function gcAttachments(sql: postgres.Sql = db(), store: AttachmentStore = attachmentStore(), batch = 200): Promise<number> {
  let total = 0;
  for (;;) {
    const claimed = await sql<{ workspace_id: string; storage_key: string }[]>`select workspace_id, storage_key from attachments_gc_claim(${batch})`;
    for (const c of claimed) await store.delete(c.storage_key).catch(() => {});
    total += claimed.length;
    if (claimed.length < batch) return total;
  }
}
let orphanCursor = ""; // last key examined; the next pass resumes after it, so a store larger than maxKeys is covered over several passes
/**
 * Deletes stored keys that no row references any more (e.g. after an issue hard delete cascaded its attachments), plus stale temp files.
 * Examines at most `maxKeys` keys per pass in sorted key order, resuming after the previous pass's cursor and wrapping to the start
 * when the end of the store is reached. Returns the number of keys removed.
 */
export async function gcOrphanKeys(sql: postgres.Sql = db(), store: AttachmentStore = attachmentStore(), maxKeys = 50_000): Promise<number> {
  const byWs = new Map<string, string[]>();
  let seen = 0, last = "", exhausted = true;
  for await (const k of store.list("")) {
    if (k <= orphanCursor) continue;
    if (seen >= maxKeys) { exhausted = false; break; }
    seen++; last = k;
    const [ws, id] = k.split("/") as [string, string];
    (byWs.get(ws) ?? byWs.set(ws, []).get(ws)!).push(id);
  }
  orphanCursor = exhausted ? "" : last;
  let removed = 0;
  for (const [ws, ids] of byWs) for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const alive = await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${ws}, true)`;
      return (await tx<{ id: string }[]>`select id from issue_attachments where id = any(${chunk}::uuid[])`).map((r) => r.id);
    });
    const keep = new Set(alive);
    for (const id of chunk) if (!keep.has(id)) { await store.delete(`${ws}/${id}`).catch(() => {}); removed++; }
  }
  removed += await store.sweepTmp(60 * 60 * 1000);
  return removed;
}
const GC_MS = 5 * 60 * 1000, ORPHAN_EVERY = 12; // orphan + temp sweep lists the whole store: hourly, not every 5 min
/** Runs gcAttachments now and every 5 min. The timer is unref'd and a failed pass only logs. */
export function startAttachmentGc(sql: postgres.Sql, intervalMs = GC_MS): () => void {
  let n = 0;
  const run = () => { void gcAttachments(sql).then(() => (n++ % ORPHAN_EVERY === 0 ? gcOrphanKeys(sql) : 0)).catch((e: unknown) => console.error(`[mini-linear] attachment gc failed: ${e instanceof Error ? e.message : String(e)}`)); };
  run();
  const t = setInterval(run, intervalMs); t.unref?.();
  return () => clearInterval(t);
}
