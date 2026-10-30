// Black-box A8 over HTTP (needs a running app, see helpers/gate): real request streaming through Next, headers and rights.
import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { world } from './helpers/world';
import { runIntegration } from './helpers/gate';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);
const req = (u: { cookie?: string } | null, method: string, path: string, init: RequestInit & { duplex?: string } = {}) =>
  fetch(BASE + path, { method, ...init, headers: { origin: BASE, ...(u?.cookie ? { cookie: u.cookie } : {}), ...(init.headers as object) } } as RequestInit);
const J = { 'content-type': 'application/json' };

describe.runIf(runIntegration)('A8 attachments over HTTP', () => {
  it('upload (content-length and chunked), download with Range, guest share, rights', async () => {
    const base = () => `/api/v1/w/w1/issues/${W.i1}/attachments`;
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300_000, 7)]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const mk = async (size: number, mime = 'application/pdf') => (await (await req(W.M1, 'POST', `${base()}/uploads`, { headers: J, body: JSON.stringify({ filename: 'big.pdf', mime_type: mime, size_bytes: size }) })).json()) as { id: string; upload_url: string };
    const a = await mk(bytes.length);
    const put = await req(W.M1, 'PUT', a.upload_url, { headers: { 'content-type': 'application/pdf' }, body: bytes });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ upload_status: 'ready', sha256: sha, size_bytes: bytes.length });
    expect((await req(W.M1, 'PUT', a.upload_url, { headers: { 'content-type': 'application/pdf' }, body: bytes })).status).toBe(409);
    const dl = await req(W.M1, 'GET', a.upload_url);
    expect(dl.status).toBe(200);
    expect(createHash('sha256').update(Buffer.from(await dl.arrayBuffer())).digest('hex')).toBe(sha);
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    const rg = await req(W.M1, 'GET', a.upload_url, { headers: { range: 'bytes=0-8' } });
    expect(rg.status).toBe(206); expect(await rg.text()).toBe('%PDF-1.7\n');
    // chunked, no Content-Length, one byte too many: 422 and the same row can be retried
    const b = await mk(10);
    const chunks = (parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(Buffer.from(p)); c.close(); } });
    const over = await req(W.M1, 'PUT', b.upload_url, { headers: { 'content-type': 'application/pdf' }, body: chunks(['%PDF-', '1234567']) as never, duplex: 'half' });
    expect(over.status).toBe(422);
    const fine = await req(W.M1, 'PUT', b.upload_url, { headers: { 'content-type': 'application/pdf' }, body: chunks(['%PDF-', '12', '345']) as never, duplex: 'half' });
    expect(fine.status).toBe(200);
    // rights
    expect((await req(W.G1, 'GET', a.upload_url)).status).toBe(200); // active share
    expect((await req(W.G1, 'POST', `${base()}/uploads`, { headers: J, body: JSON.stringify({ filename: 'x.pdf', mime_type: 'application/pdf', size_bytes: 1 }) })).status).toBe(403);
    expect((await req(W.M2, 'GET', a.upload_url)).status).toBe(404); // member of another team
    expect((await req(W.B1, 'GET', a.upload_url)).status).toBe(404); // other workspace
    expect((await req(null, 'GET', a.upload_url)).status).toBe(401);
    expect((await req(W.M1, 'POST', `${base()}/uploads`, { headers: J, body: JSON.stringify({ filename: 'x.svg', mime_type: 'image/svg+xml', size_bytes: 1 }) })).status).toBe(415);
    expect((await req(W.M1, 'POST', `${base()}/uploads`, { headers: J, body: JSON.stringify({ filename: 'x.pdf', mime_type: 'application/pdf', size_bytes: 26 * 1024 * 1024 }) })).status).toBe(413);
    expect((await req(W.M2, 'DELETE', `${base()}/${a.id}`)).status).toBe(404);
    expect((await req(W.M1, 'DELETE', `${base()}/${a.id}`)).status).toBe(204);
    expect((await req(W.M1, 'GET', a.upload_url)).status).toBe(404);
  }, 60_000);

  it('a client that disconnects mid-upload leaves the row retryable and holds no lock', async () => {
    const base = `/api/v1/w/w1/issues/${W.i1}/attachments`;
    const a = (await (await req(W.M1, 'POST', `${base}/uploads`, { headers: J, body: JSON.stringify({ filename: 'cut.pdf', mime_type: 'application/pdf', size_bytes: 10 }) })).json()) as { id: string; upload_url: string };
    const ac = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from('%PDF-')); } });
    const p = req(W.M1, 'PUT', a.upload_url, { headers: { 'content-type': 'application/pdf' }, body: body as never, duplex: 'half', signal: ac.signal } as never).catch(() => null);
    await new Promise((r) => setTimeout(r, 400));
    ac.abort(); await p;
    // the row is reclaimed by the idle timeout (30 s) or immediately when the abort propagates; a retry must eventually succeed
    let st = 0;
    for (let i = 0; i < 40 && st !== 200; i++) {
      st = (await req(W.M1, 'PUT', a.upload_url, { headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF-12345') })).status;
      if (st !== 200) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(st).toBe(200);
  }, 90_000);
});
