// Lane 3 (hardening): every write route, discovered from the filesystem, must behave on the three basics:
// no session -> 401, non-member of the workspace -> 404 (never 2xx), guest -> never 2xx/5xx, and hostile bodies -> 4xx (never 500).
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { api, world } from './helpers/world';
import { runIntegration } from './helpers/gate';

const ROOT = join(process.cwd(), 'src/app/api/v1');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('route.ts') ? [p] : []; });
type R = { method: string; path: string; file: string };
// Public or non-workspace-scoped routes have their own suites (auth, webhooks, invites accept).
const NOT_WS = /\/(auth|integrations\/github\/webhook|invites\/accept|me|workspaces)(\/|$)/;
const routes: R[] = walk(ROOT).flatMap((file) => {
  const rel = file.slice(ROOT.length, -'/route.ts'.length);
  if (!rel.startsWith('/w/[slug]') || NOT_WS.test(rel)) return [];
  const src = readFileSync(file, 'utf8');
  const methods = ['POST', 'PATCH', 'PUT', 'DELETE'].filter((m) => new RegExp(`export (async function|const) ${m}\\b`).test(src));
  return methods.map((method) => ({ method, file, path: '/api/v1' + rel.replace('[slug]', 'w1').replace(/\[[^\]]+\]/g, () => randomUUID()) }));
});

let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { if (runIntegration) W = await world(); }, 60_000);
const label = (r: R) => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/g, ':id')}`;

describe.runIf(runIntegration)('write-route sweep', () => {
  it('discovers the write routes', () => { expect(routes.length).toBeGreaterThan(60); });

  it('no session -> 401 with the standard error body', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await api(null, r.method, r.path, r.method === 'DELETE' ? undefined : {});
      if (res.status !== 401) bad.push(`${label(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('a user of another workspace gets 404 (slug not enumerable), never 2xx/5xx', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await api(W.B1, r.method, r.path, r.method === 'DELETE' ? undefined : {});
      if (res.status !== 404) bad.push(`${label(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('a guest never gets a 2xx or 5xx on a write route (random ids)', async () => {
    const bad: string[] = [];
    for (const r of routes) {
      // A caller's own notifications are theirs whatever their role: those two bulk routes legitimately answer 200 to a guest.
      if (/\/notifications\/(read-all|archive-read)$/.test(r.path)) continue;
      const res = await api(W.G1, r.method, r.path, r.method === 'DELETE' ? undefined : {});
      if (res.status < 400 || res.status >= 500) bad.push(`${label(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('hostile bodies as an admin are 4xx, never 5xx', async () => {
    const bodies: [string, string][] = [['not json', '{broken'], ['array', '[]'], ['null', 'null'], ['wrong types', JSON.stringify({ title: 123, name: [], id: {}, status: 5, email: 7, url: 1, role: 1, color: 1 })], ['huge string', JSON.stringify({ title: 'x'.repeat(300_000), name: 'x'.repeat(300_000) })]];
    const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const bad: string[] = [];
    for (const r of routes.filter((x) => x.method !== 'DELETE')) {
      for (const [n, body] of bodies) {
        const res = await fetch(base + r.path, { method: r.method, headers: { 'content-type': 'application/json', origin: base, cookie: W.A1.cookie! }, body });
        if (res.status >= 500) bad.push(`${label(r)} [${n}] -> ${res.status}`);
        else if (res.status >= 400 && n !== 'huge string') { const j = await res.json().catch(() => null); if (!j?.error?.code || !j.error.request_id) bad.push(`${label(r)} [${n}] -> ${res.status} non-standard body`); }
      }
    }
    expect(bad).toEqual([]);
  }, 300_000);

  it('malformed path ids are 4xx, never 5xx', async () => {
    const bad: string[] = [];
    for (const r of routes.filter((x) => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(x.path))) {
      const p = r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'not-a-uuid');
      const res = await api(W.A1, r.method, p, r.method === 'DELETE' ? undefined : {});
      if (res.status >= 500 || res.status < 400) bad.push(`${label(r)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('malformed list query params on GET collections are 4xx or clamped, never 5xx', async () => {
    const lists = ['issues', 'projects', 'cycles', 'labels', 'views', 'notifications', 'webhooks', 'api-keys', 'invites', 'teams', 'members'];
    const qs = ['limit=abc', 'limit=-1', 'limit=999999', 'cursor=garbage', 'cursor=' + 'x'.repeat(5000), 'q=' + 'x'.repeat(5000), 'sort=%00', 'team_id=nope', 'status=%27%3B--'];
    const bad: string[] = [];
    for (const l of lists) for (const q of qs) {
      const res = await api(W.A1, 'GET', `/api/v1/w/w1/${l}?${q}`);
      if (res.status >= 500) bad.push(`GET ${l}?${q.slice(0, 30)} -> ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);
});
