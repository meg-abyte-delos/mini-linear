import { createHash } from "node:crypto";
import { db, withWorkspaceCtx, requireRole } from "../http/ctx";
import { ApiError } from "../http/errors";
import { audit, type Row } from "./common";
import { magicOk } from "../attachments/uploads";

export const MAX_LOGO_BYTES = 1024 * 1024;
const MULTIPART_OVERHEAD = 16 * 1024; // boundaries + part headers around the 1 MiB file
const TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The stored `logo:<hash>` marker becomes the relative path the API serves; https URLs and null pass through. */
export const logoDto = <T extends Row>(w: T): T => {
  const v = w.logo_url;
  return typeof v === "string" && v.startsWith("logo:") ? { ...w, logo_url: `/api/v1/w/${w.slug as string}/settings/logo?v=${v.slice(5)}` } : w;
};

/** Reads the request body with a hard cap, so an oversized upload is refused without buffering it all. */
async function readCapped(req: Request, cap: number): Promise<Uint8Array> {
  const cl = req.headers.get("content-length");
  if (cl !== null && Number(cl) > cap) throw new ApiError("payload_too_large", "logo exceeds 1 MiB");
  if (!req.body) throw new ApiError("bad_request", "missing body");
  const chunks: Uint8Array[] = []; let n = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > cap) { await reader.cancel().catch(() => {}); throw new ApiError("payload_too_large", "logo exceeds 1 MiB"); }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** POST /w/:slug/settings/logo: multipart/form-data, field "file". Admin/owner. Type comes from the magic bytes, never from the name or declared type. */
export const uploadLogo = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  requireRole(ctx, "admin");
  const ct = req.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=/i.test(ct)) throw new ApiError("unsupported_media_type", "expected multipart/form-data");
  const raw = await readCapped(req, MAX_LOGO_BYTES + MULTIPART_OVERHEAD);
  let file: FormDataEntryValue | null;
  try { file = (await new Response(new Blob([raw as BlobPart]), { headers: { "content-type": ct } }).formData()).get("file"); }
  catch { throw new ApiError("bad_request", "malformed multipart body"); }
  if (!file || typeof file === "string") throw new ApiError("bad_request", 'missing "file" part');
  if (file.size > MAX_LOGO_BYTES) throw new ApiError("payload_too_large", "logo exceeds 1 MiB");
  if (file.size === 0) throw new ApiError("bad_request", "empty file");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = TYPES.find((t) => magicOk(t, bytes));
  if (!mime) throw new ApiError("unsupported_media_type", "logo must be a png, jpeg or webp image");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const before = (await ctx.tx<Row[]>`select logo_url from get_workspace_settings()`)[0];
  if (!before) throw new ApiError("not_found");
  await ctx.tx`insert into workspace_logos (workspace_id, mime, data, sha256) values (${ctx.workspaceId}, ${mime}, ${Buffer.from(bytes)}, ${sha})
    on conflict (workspace_id) do update set mime = excluded.mime, data = excluded.data, sha256 = excluded.sha256, updated_at = now()`;
  const marker = `logo:${sha.slice(0, 16)}`;
  const r = await ctx.tx<Row[]>`select * from update_workspace_settings(${null}, ${null}, ${marker})`;
  await audit(ctx, "workspace", ctx.workspaceId, "update", { logo_url: { before: before.logo_url, after: marker } });
  return Response.json({ ...logoDto(r[0]!), role: ctx.role }, { status: 201 });
}, db(), { rawReq: true });

/** GET /w/:slug/settings/logo: any member. Immutable per hash (the ?v= query), served nosniff and sandboxed. */
export const getLogo = (req: Request, slug: string) => withWorkspaceCtx(req, slug, async (ctx) => {
  const r = (await ctx.tx<{ mime: string; data: Buffer; sha256: string }[]>`select mime, data, sha256 from workspace_logos`)[0];
  if (!r) throw new ApiError("not_found");
  const etag = `"${r.sha256}"`;
  const h = { ETag: etag, "Cache-Control": "private, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
  return new Response(new Uint8Array(r.data), { status: 200, headers: { ...h, "Content-Type": r.mime, "Content-Length": String(r.data.length) } });
});
