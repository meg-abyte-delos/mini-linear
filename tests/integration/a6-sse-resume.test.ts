// Area 6, SSE resume (black-box, running app + DB). The server already honours the Last-Event-ID header and the ?last_event_id= fallback
// (src/lib/sync/server/sse.ts); this pins the behaviour: events missed while disconnected are replayed, nothing older is replayed,
// and an unknown or forged id yields a `resync` event instead of a 500 or a silent gap.
import { describe, it, expect, beforeAll } from 'vitest';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

let W: Awaited<ReturnType<typeof world>>;
const P = '/api/v1/w/w1';
const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const cursorOf = async (u: typeof W.M1): Promise<string> => {
  const r = await api(u, 'GET', `${P}/sync`);
  expect(r.status).toBe(200);
  return ((await r.json()) as { cursor: string }).cursor;
};
const mkIssue = async (u: typeof W.M1, team: string, title: string) => {
  const r = await api(u, 'POST', `${P}/issues`, { title, team_id: team });
  expect(r.status).toBe(201);
  return (await r.json()).id as string;
};
/** Reads an SSE response until `until` matches the accumulated text, the stream ends, or the deadline passes. */
async function readSse(res: Response, until: RegExp, ms: number) {
  const rd = res.body!.getReader(), dec = new TextDecoder();
  let text = '';
  const stop = Date.now() + ms;
  while (Date.now() < stop && !until.test(text)) {
    const r = await Promise.race([rd.read(), new Promise<null>((s) => setTimeout(() => s(null), Math.max(50, stop - Date.now())))]);
    if (r === null || r.done) break;
    text += dec.decode(r.value);
  }
  await rd.cancel().catch(() => undefined);
  return text;
}

beforeAll(async () => { if (runIntegration) W = await world(); });

describe.runIf(runIntegration)('A6 SSE resume with Last-Event-ID', () => {
  it('replays the events created while the client was disconnected (header)', async () => {
    const c = await cursorOf(W.M1);
    const id = await mkIssue(W.M1, W.t1, 'created while offline');
    const ac = new AbortController();
    const res = await fetch(`${BASE}${P}/events`, { headers: { cookie: W.M1.cookie!, origin: BASE, 'last-event-id': c }, signal: ac.signal });
    expect(res.status).toBe(200);
    const text = await readSse(res, /event: issue\.create/, 8000);
    ac.abort();
    expect(text).toContain(id);
    expect(text).not.toMatch(/event: resync/);
  }, 15_000);

  it('accepts the ?last_event_id= fallback and does not replay events older than the cursor', async () => {
    const old = await mkIssue(W.M1, W.t1, 'before the cursor');
    const c = await cursorOf(W.M1);
    const fresh = await mkIssue(W.M1, W.t1, 'after the cursor');
    const ac = new AbortController();
    const res = await fetch(`${BASE}${P}/events?last_event_id=${encodeURIComponent(c)}`, { headers: { cookie: W.M1.cookie!, origin: BASE }, signal: ac.signal });
    expect(res.status).toBe(200);
    const text = await readSse(res, /event: issue\.create/, 8000);
    ac.abort();
    expect(text).toContain(fresh);
    expect(text).not.toContain(old);
  }, 15_000);

  it('a forged or foreign Last-Event-ID gets a resync event (never a 500)', async () => {
    const theirs = await cursorOf(W.M2);
    for (const bad of ['AAAAAAAAAAAAAAAAAAAAAA', theirs, 'x'.repeat(60)]) {
      const ac = new AbortController();
      const res = await fetch(`${BASE}${P}/events`, { headers: { cookie: W.M1.cookie!, origin: BASE, 'last-event-id': bad }, signal: ac.signal });
      expect(res.status, bad).toBe(200);
      const text = await readSse(res, /event: resync/, 8000);
      ac.abort();
      expect(text, bad).toMatch(/event: resync/);
    }
  }, 30_000);
});
