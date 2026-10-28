import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
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

/**
 * SSRF guard at subscription time: https only in production (http allowed elsewhere), no credentials in the URL,
 * no literal private/loopback/link-local IP and no localhost-ish hostnames. DNS rebinding is NOT covered here:
 * deploy the dispatcher behind an egress proxy that blocks private ranges (documented in API.md).
 */
export function webhookUrlError(raw: string, nodeEnv = process.env.NODE_ENV): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "invalid url"; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && nodeEnv !== "production")) return "url must be https";
  if (u.username || u.password) return "url must not embed credentials";
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (nodeEnv === "production" && (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || isPrivateIp(h))) return "url host not allowed";
  return null;
}
export function isPrivateIp(h: string): boolean {
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === "::1" || h === "::" || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("::ffff:");
  return false;
}

type Claimed = { id: string; workspace_id: string; webhook_id: string; event: string; payload: unknown; attempts: number; url: string; secret: string };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One dispatcher tick: claim due deliveries (leased, SKIP LOCKED), POST them signed, record the outcome. Returns how many were tried. */
export async function dispatchOnce(sql: postgres.Sql, opts: { limit?: number; fetcher?: Fetcher; timeoutMs?: number; now?: () => number } = {}): Promise<number> {
  const f = opts.fetcher ?? fetch;
  const rows = await sql<Claimed[]>`select * from claim_webhook_deliveries(${opts.limit ?? 20})`;
  await Promise.all(rows.map(async (d) => {
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    const t = Math.floor((opts.now ?? Date.now)() / 1000);
    let ok = false, status: number | null = null, err: string | null = null;
    try {
      const r = await f(d.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000), body,
        headers: { "content-type": "application/json", "user-agent": "Mini-Linear-Webhooks/1", "x-minilinear-event": d.event, "x-minilinear-delivery": d.id, "x-minilinear-signature": sign(d.secret, body, t) } });
      status = r.status; ok = r.status >= 200 && r.status < 300;
      if (!ok) err = `HTTP ${r.status}`;
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    await sql`select complete_webhook_delivery(${d.id}, ${ok}, ${status}, ${err})`;
  }));
  return rows.length;
}

/** Background loop (instrumentation.ts). unref'd timer; errors logged, never thrown. Returns a stop function. */
export function startWebhookDispatcher(sql: postgres.Sql, opts: { intervalMs?: number; log?: (m: string) => void } = {}): () => void {
  const log = opts.log ?? ((m: string) => console.error(m));
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    dispatchOnce(sql).catch((e: unknown) => log(`[mini-linear] webhook dispatch failed: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { busy = false; });
  };
  const timer = setInterval(tick, opts.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
