import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import type postgres from "postgres";

export const WEBHOOK_EVENTS = ["issue.created", "issue.updated", "issue.deleted", "comment.created", "comment.updated", "comment.deleted", "project.created", "project.updated", "project.deleted"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const MAX_ATTEMPTS = 8;

export const newWebhookSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

/**
 * Signature header (Stripe-style): `X-MiniLinear-Signature: t=<unix>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>`.
 * Receivers recompute it and reject a timestamp older than their tolerance (replay protection).
 */
export const sign = (secret: string, body: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
export function verify(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(now - t) > toleranceSec) return false;
  const want = Buffer.from(sign(secret, body, t).split("v1=")[1]!, "hex"), got = Buffer.from(m[2]!, "hex");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Backoff mirrored from complete_webhook_delivery(): 30s * 2^(attempt-1), capped at 6h. */
export const backoffSec = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 6 * 3600);

const allowPrivate = () => process.env.ML_WEBHOOKS_ALLOW_PRIVATE === '1'; // dev/CI only (loopback test receivers); never set in prod

/** Every range a webhook must never reach: private, loopback, link-local, CGNAT, reserved, multicast, NAT64, 6to4, Teredo, documentation. */
const BLOCKED = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) BLOCKED.addSubnet(net, bits, 'ipv6');

/** true for any non-public address (IPv4-mapped / IPv4-compatible IPv6 forms are judged by their IPv4 part). */
export function isPrivateIp(raw: string): boolean {
  const h = raw.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0]!;
  const v = isIP(h);
  if (v === 4) return BLOCKED.check(h, 'ipv4');
  if (v === 6) {
    const m = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (m) return BLOCKED.check(m[1]!, 'ipv4');
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // ::ffff:7f00:1 form
    if (hex) { const a = parseInt(hex[1]!, 16), b = parseInt(hex[2]!, 16); return BLOCKED.check(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, 'ipv4'); }
    return BLOCKED.check(h, 'ipv6');
  }
  return false;
}

/** Hostname for policy checks: lowercased, brackets and trailing dots stripped ('localhost.' is localhost). */
const cleanHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
const effectivePort = (u: URL) => Number(u.port || (u.protocol === 'https:' ? 443 : 80));

/**
 * Subscription-time URL guard: https only in production, no credentials, port 443 or >1024, no localhost-ish names
 * (trailing dot stripped) and no literal private IP. Names that RESOLVE to private IPs (nip.io, DNS rebinding) are
 * caught at send time by safeFetch's pinned lookup, not here.
 */
export function webhookUrlError(raw: string, nodeEnv = process.env.NODE_ENV): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return 'invalid url'; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && nodeEnv !== 'production')) return 'url must be https';
  if (u.username || u.password) return 'url must not embed credentials';
  const port = effectivePort(u);
  if (port !== 443 && port <= 1024) return 'url port not allowed (443 or above 1024)';
  const h = cleanHost(u);
  if (nodeEnv === 'production' && (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || isPrivateIp(h))) return 'url host not allowed';
  return null;
}

/** dns.lookup replacement for http(s).request: resolves ALL addresses, refuses if ANY is non-public, and hands the validated address to the socket (the connection goes to the IP that was checked: no rebinding window). */
export function guardedLookup(host: string, opts: { all?: boolean } | number | undefined, cb: (...a: unknown[]) => void, allow = allowPrivate()): void {
  const o = typeof opts === 'object' && opts ? opts : {};
  dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateIp(a.address));
    if (bad && !allow) return cb(new Error(`webhook host resolves to a non-public address (${bad.address})`));
    if (o.all) return cb(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}

/** Send-time URL check (literal IPs skip DNS lookup, so they are judged here). */
export function destinationError(u: URL, allow = allowPrivate()): string | null {
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allow)) return 'url must be https';
  if (u.username || u.password) return 'url must not embed credentials';
  const port = effectivePort(u);
  if (!allow && port !== 443 && port <= 1024) return 'url port not allowed';
  const h = cleanHost(u);
  if (!allow && (h === 'localhost' || h.endsWith('.localhost') || isPrivateIp(h))) return 'url host not allowed';
  return null;
}

/** Default delivery transport: node http(s) with the guarded lookup. Redirects are never followed; only the status is returned. */
export const safeFetch: Fetcher = (url, init) => new Promise((resolve, reject) => {
  const u = new URL(url), bad = destinationError(u);
  if (bad) return reject(new Error(bad));
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request(u, { method: init.method ?? 'POST', headers: init.headers as Record<string, string>, signal: init.signal ?? undefined, lookup: guardedLookup as never }, (res) => {
    res.resume();
    resolve(new Response(null, { status: res.statusCode ?? 502 }));
    res.destroy();
  });
  req.on('error', reject);
  req.end(init.body as string);
});

type Claimed = { id: string; workspace_id: string; webhook_id: string; event: string; payload: unknown; attempts: number; url: string; secret: string };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type DispatchOpts = { limit?: number; fetcher?: Fetcher; timeoutMs?: number; now?: () => number; asRole?: boolean };
/** claim_/complete_/purge_ are executable by webhook_dispatcher only. Either `sql` already is a connection of that role (WEBHOOK_DISPATCHER_DATABASE_URL), or asRole=true and each call runs SET LOCAL ROLE in its own tx. */
const asDispatcher = <T>(sql: postgres.Sql, asRole: boolean | undefined, fn: (s: postgres.Sql) => Promise<T>): Promise<T> =>
  asRole ? (sql.begin(async (tx) => { await tx.unsafe('set local role webhook_dispatcher'); return fn(tx as unknown as postgres.Sql); }) as Promise<T>) : fn(sql);

/** One dispatcher tick: claim due deliveries (leased, SKIP LOCKED), POST them signed, record the outcome. Returns how many were tried. */
export async function dispatchOnce(sql: postgres.Sql, opts: DispatchOpts = {}): Promise<number> {
  const f = opts.fetcher ?? safeFetch;
  const rows = await asDispatcher(sql, opts.asRole, (s) => s<Claimed[]>`select * from claim_webhook_deliveries(${opts.limit ?? 20})`);
  await Promise.all(rows.map(async (d) => {
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    const t = Math.floor((opts.now ?? Date.now)() / 1000);
    let ok = false, status: number | null = null, err: string | null = null;
    try {
      const r = await f(d.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), body,
        headers: { 'content-type': 'application/json', 'user-agent': 'Mini-Linear-Webhooks/1', 'x-minilinear-event': d.event, 'x-minilinear-delivery': d.id, 'x-minilinear-signature': sign(d.secret, body, t) } });
      status = r.status; ok = r.status >= 200 && r.status < 300;
      if (!ok) err = `HTTP ${r.status}`;
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    await asDispatcher(sql, opts.asRole, (s) => s`select complete_webhook_delivery(${d.id}, ${d.workspace_id}, ${ok}, ${status}, ${err})`);
  }));
  return rows.length;
}

export const RETENTION_DAYS = Number(process.env.WEBHOOK_RETENTION_DAYS ?? 30);
/** Delete finished deliveries older than RETENTION_DAYS (batches of 5000). */
export const purgeDeliveries = (sql: postgres.Sql, asRole?: boolean) => asDispatcher(sql, asRole, (s) => s`select purge_webhook_deliveries(${RETENTION_DAYS})`);

/** Background loop (instrumentation.ts). unref'd timers; errors logged, never thrown. Returns a stop function. */
export function startWebhookDispatcher(sql: postgres.Sql, opts: { intervalMs?: number; asRole?: boolean; log?: (m: string) => void } = {}): () => void {
  const log = opts.log ?? ((m: string) => console.error(m));
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    dispatchOnce(sql, { asRole: opts.asRole }).catch((e: unknown) => log(`[mini-linear] webhook dispatch failed: ${msg(e)}`)).finally(() => { busy = false; });
  };
  const purge = () => { purgeDeliveries(sql, opts.asRole).catch((e: unknown) => log(`[mini-linear] webhook purge failed: ${msg(e)}`)); };
  const timer = setInterval(tick, opts.intervalMs ?? 5000), ptimer = setInterval(purge, 60 * 60 * 1000);
  timer.unref?.(); ptimer.unref?.();
  purge();
  return () => { clearInterval(timer); clearInterval(ptimer); };
}
