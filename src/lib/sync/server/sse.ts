// GET /api/v1/w/:slug/events : Server-Sent Events over the sync_events feed.
// Each tick re-runs the full workspace ctx (session + membership + RLS), so a revoked session or a removed member stops
// receiving within one tick and the stream closes. DB-backed polling (no in-process bus) => works across instances.
import { withWorkspaceCtx } from '../../http/ctx';
import { ApiError, errorResponse } from '../../http/errors';
import { parseCursor, readFeed, type FeedPage } from './feed';

export const SSE = { pollMs: 500, heartbeatMs: 15_000, maxLifetimeMs: 10 * 60_000, perUserMax: 10 };
const open = new Map<string, number>(); // user/slug key -> open streams in this instance
export const openStreams = () => [...open.values()].reduce((a, b) => a + b, 0);

/** SSE framing: one `data:` line per JSON line (JSON.stringify never emits raw newlines, but be strict anyway). */
export function frame(ev: { id?: string; event: string; data: unknown }): string {
  const body = JSON.stringify(ev.data).split(/\r?\n/).map((l) => `data: ${l}`).join('\n');
  return `${ev.id ? `id: ${ev.id}\n` : ''}event: ${ev.event}\n${body}\n\n`;
}

function foreignOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin === null) return req.headers.get('sec-fetch-site') === 'cross-site';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  try { return new URL(origin).host !== host; } catch { return true; }
}

export async function eventsRoute(req: Request, slug: string): Promise<Response> {
  if (foreignOrigin(req)) return errorResponse(new ApiError('forbidden', 'cross-origin request refused'));
  const url = new URL(req.url);
  const raw = req.headers.get('last-event-id') ?? url.searchParams.get('last_event_id');
  let cursor = parseCursor(raw);
  // First tick authenticates before any stream is opened: 401/404 are plain JSON errors.
  let page: FeedPage | null = null; let userKey = '';
  const tick = async (): Promise<Response> => withWorkspaceCtx(req, slug, async (ctx) => {
    userKey = `${ctx.userId}:${ctx.workspaceId}`;
    page = await readFeed(ctx, cursor);
    return new Response(null, { status: 204 });
  });
  const first = await tick();
  if (first.status !== 204) return first;
  if ((open.get(userKey) ?? 0) >= SSE.perUserMax) return errorResponse(new ApiError('rate_limited', 'too many open streams'));
  open.set(userKey, (open.get(userKey) ?? 0) + 1);
  const enc = new TextEncoder();
  let closed = false; let timer: ReturnType<typeof setTimeout> | undefined;
  const release = () => { if (closed) return; closed = true; if (timer) clearTimeout(timer); const n = (open.get(userKey) ?? 1) - 1; if (n > 0) open.set(userKey, n); else open.delete(userKey); };
  const started = Date.now(); let lastWrite = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (s: string) => { if (closed) return; try { c.enqueue(enc.encode(s)); lastWrite = Date.now(); } catch { release(); } };
      const emit = (p: FeedPage) => {
        if (p.resync) send(frame({ id: p.cursor, event: 'resync', data: { cursor: p.cursor } }));
        for (const e of p.events) send(frame({ id: e.id, event: `${e.entity}.${e.op}`, data: e }));
        if (p.events.length === 0 && !p.resync && cursor?.toString() !== p.cursor) send(`id: ${p.cursor}\n\n`); // advance Last-Event-ID past filtered events
        cursor = BigInt(p.cursor);
      };
      send(`retry: 2000\n: open\n\n`);
      emit(page!);
      const loop = async () => {
        if (closed) return;
        if (Date.now() - started > SSE.maxLifetimeMs) { release(); try { c.close(); } catch { /* gone */ } return; }
        const r = await tick().catch(() => new Response(null, { status: 500 }));
        if (r.status === 401 || r.status === 404 || r.status === 403) { send(frame({ event: 'auth', data: { status: r.status } })); release(); try { c.close(); } catch { /* gone */ } return; }
        if (r.status === 204 && page) emit(page);
        if (Date.now() - lastWrite >= SSE.heartbeatMs) send(': ping\n\n');
        timer = setTimeout(() => { void loop(); }, SSE.pollMs);
      };
      timer = setTimeout(() => { void loop(); }, SSE.pollMs);
      req.signal?.addEventListener('abort', () => { release(); try { c.close(); } catch { /* gone */ } });
    },
    cancel() { release(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
