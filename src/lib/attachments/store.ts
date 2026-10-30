import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Binary storage behind a fixed interface (A8 contract). `fs` for dev/CI; an s3 implementation plugs in later. */
export type PutResult = { size: number; sha256: string };
export interface AttachmentStore {
  /** Streams `body` to `key`; resolves with the byte count and sha256 actually received. Rejects (and leaves nothing behind) when the body is not exactly `opts.size` bytes. */
  put(key: string, body: ReadableStream<Uint8Array>, opts: { size: number; mime: string }): Promise<PutResult>;
  get(key: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
  /** Every stored key starting with `prefix` ("" = all, `<workspace_id>/` = one workspace). Partial uploads (temp files) are never listed. */
  list(prefix: string): AsyncIterable<string>;
}
export class SizeMismatch extends Error {}

/** Keys are `<workspace uuid>/<attachment uuid>`, server generated. Anything else is refused so a key can never walk out of the root. */
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const storageKey = (workspaceId: string, attachmentId: string) => `${workspaceId}/${attachmentId}`;

export function fsStore(root: string): AttachmentStore {
  const base = resolve(root);
  const path = (key: string) => {
    if (!KEY.test(key)) throw new Error("invalid storage key");
    const p = resolve(base, key);
    if (!p.startsWith(base + sep)) throw new Error("invalid storage key");
    return p;
  };
  return {
    async put(key, body, opts) {
      const dest = path(key), tmp = join(dirname(dest), `.${randomUUID()}.tmp`);
      await mkdir(dirname(dest), { recursive: true });
      const hash = createHash("sha256"); let n = 0;
      const meter = new Transform({ transform(chunk: Buffer, _e, cb) {
        n += chunk.length;
        if (n > opts.size) return cb(new SizeMismatch("body longer than declared size"));
        hash.update(chunk); cb(null, chunk);
      } });
      try {
        await pipeline(Readable.fromWeb(body as never), meter, createWriteStream(tmp, { mode: 0o600 }));
        if (n !== opts.size) throw new SizeMismatch("body shorter than declared size");
        await rename(tmp, dest);
      } catch (e) { await rm(tmp, { force: true }); throw e; }
      return { size: n, sha256: hash.digest("hex") };
    },
    async get(key, range) {
      const p = path(key);
      let size: number;
      try { size = (await stat(p)).size; } catch { return null; }
      const rs = createReadStream(p, range ? { start: range.start, end: range.end } : undefined);
      return { stream: Readable.toWeb(rs) as unknown as ReadableStream<Uint8Array>, size };
    },
    async delete(key) { await rm(path(key), { force: true }); },
    async *list(prefix) {
      let top: string[];
      try { top = await readdir(base); } catch { return; }
      for (const ws of top) {
        if (!ws.startsWith(prefix.split("/")[0]!) ) continue;
        let files: string[];
        try { files = await readdir(join(base, ws)); } catch { continue; }
        for (const f of files) { const k = `${ws}/${f}`; if (KEY.test(k) && k.startsWith(prefix)) yield k; }
      }
    },
  };
}

let _store: AttachmentStore | undefined;
const SKEY = Symbol.for("mini-linear.attachmentStore");
type G = typeof globalThis & { [SKEY]?: AttachmentStore };
/** The process-wide store. Tests may replace it with setAttachmentStore. */
export const attachmentStore = (): AttachmentStore => (globalThis as G)[SKEY] ?? (_store ??= fsStore(process.env.ATTACHMENTS_DIR ?? "./.data/attachments"));
export const setAttachmentStore = (s: AttachmentStore | undefined) => { (globalThis as G)[SKEY] = s; };
