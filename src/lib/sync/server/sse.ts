// GET /api/v1/w/:slug/events : Server-Sent Events over the sync_events feed.
// Polls the DB every pollMs (no in-process bus => works across instances). Full authentication (session / API key, rate limit,
// membership, RLS) runs on the first tick and then once every authEvery ticks; the ticks in between only re-check membership
// (resolve_workspace) and read the feed, so a stream does not eat the API key rate limit. A removed member stops within one tick,
// a revoked session / key within authEvery * pollMs (10 s); the stream then closes with an auth event.
// Cross-origin cookie requests are refused by withWorkspaceCtx (originAllowed); this route does no Host / X-Forwarded-Host check of its own.
import { db, withWorkspaceCtx, type Ctx } from '../../http/ctx';
import { ApiError, errorResponse } from '../../http/errors';
import { readFeed, type FeedPage } from './feed';

export const SSE = { pollMs: 2000, authEvery: 5, heartbeatMs: 15_000, maxLifetimeMs: 10 * 60_000, perUserMax: 10 };
const open = new Map<string, number>(); // user/slug key -> open streams in this instance
export const openStreams = () => [...open.values()].reduce((a, b) => a + b, 0);

/** SSE framing: one data line per JSON line (JSON.stringify never emits raw newlines, but be strict anyway). */
export function frame(ev: { id?: string; event: string; data: unknown }): string {
  const body = JSON.stringify(ev.data).split(/\r?\n/).map((l) => `data: ${l}`).join('\n');
  return `${ev.id ? `id: ${ev.id}\n` : ''}event: ${ev.event}\n${body}\n\n`;
}

export async function eventsRoute(req: Request, slug: string): Promise<Response> {
  const url = new URL(req.url);
  const raw = req.headers.get('last-event-id') ?? url.searchParams.get('last_event_id');
  let cursor: string | null = raw && raw.trim() ? raw.trim().slice(0, 64) : null; // sealed token, validated by readFeed
  let page: FeedPage | null = null; let userKey = ''; let known: Ctx | null = null; let ticks = 0;
  const full = (): Promise<Response> => withWorkspaceCtx(req, slug, async (ctx) => {
    userKey = `${ctx.userId}:${ctx.workspaceId}`;
    known = { userId: ctx.userId, workspaceId: ctx.workspaceId, role: ctx.role, req } as Ctx;
    page = await readFeed(ctx, cursor);
    return new Response(null, { status: 204 });
  });
  // Between full authentications: same user, workspace and role, but membership is re-verified and RLS re-applied.
  const light = async (): Promise<Response> => {
    const k = known!;
    try {
      page = await db().begin(async (tx) => {
        const rows = await tx<{ workspace_id: string }[]>`select workspace_id from resolve_workspace(${slug}, ${k.userId})`;
        if (rows.length === 0 || rows[0]!.workspace_id !== k.workspaceId) throw new ApiError('not_found');
        await tx`select set_config('app.workspace_id', ${k.workspaceId}, true)`;
        await tx`select set_config('app.user_id', ${k.userId}, true)`;
        return readFeed({ ...k, tx } as Ctx, cursor);
      });
      return new Response(null, { status: 204 });
    } catch (e) { return e instanceof ApiError ? errorResponse(e) : new Response(null, { status: 500 }); }
  };
  const tick = (): Promise<Response> => {
    if (known && ticks++ % SSE.authEvery !== 0) return light();
    ticks = 1;
    return full();
  };
  // First tick authenticates before any stream is opened: 401/404 are plain JSON errors.
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
        if (p.events.length === 0 && !p.resync && cursor !== p.cursor) send(`id: ${p.cursor}\n\n`); // advance Last-Event-ID past filtered events
        cursor = p.cursor;
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
