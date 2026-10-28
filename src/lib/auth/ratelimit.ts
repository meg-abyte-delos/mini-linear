import type postgres from "postgres";
import { isIP } from "node:net";
import { ApiError } from "../http/errors";

/**
 * Fixed-window limiter in Postgres (rate_limits). One atomic upsert per hit, so the count is shared by every app instance.
 * Keys are namespaced by caller ("login:ip:1.2.3.4"). Over the limit -> 429 rate_limited.
 */
export async function hit(sql: postgres.Sql, key: string, limit: number, windowSec: number): Promise<void> {
  const rows = await sql<{ count: number }[]>`
    insert into rate_limits (key, window_start, count)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (rows[0]!.count > limit) throw new ApiError("rate_limited", "too many requests");
}

/** Client address: first X-Forwarded-For hop (the app is assumed to run behind one trusted proxy), else a shared bucket. */
/** Socket peer address seam: Next route handlers expose none on Request, so the host adapter may set it. Default is a shared "unknown" bucket (fails closed). */
let socketAddr: (req: Request) => string | null = () => null;
let socketResolverSet = false;
export const setSocketAddrResolver = (f: typeof socketAddr) => { socketAddr = f; socketResolverSet = true; };
/** Test seam: forget the resolver. */
export const resetSocketAddrResolverForTests = () => { socketAddr = () => null; socketResolverSet = false; };
/**
 * The shared "unknown" bucket must not reach production: every request would share one rate-limit key.
 * Called at startup (src/instrumentation.ts). With NODE_ENV=production and no resolver it THROWS (fail closed);
 * elsewhere it warns. Returns true if a warning was emitted.
 */
export const warnIfNoSocketResolver = (
  log: (m: string) => void = (m) => console.warn(m),
  nodeEnv: string | undefined = process.env.NODE_ENV,
  // Explicit escape hatch for the e2e harness (next start on localhost). Never set it in a real deployment.
  allowShared: string | undefined = process.env.ML_ALLOW_SHARED_RATELIMIT_BUCKET,
): boolean => {
  if (socketResolverSet) return false;
  if (nodeEnv === "production" && allowShared !== "1") {
    throw new Error("[mini-linear] setSocketAddrResolver is not set in production: all requests without a trusted X-Forwarded-For hop would share one rate-limit bucket. Refusing to start.");
  }
  log("[mini-linear] WARNING: setSocketAddrResolver is not set; requests without a trusted X-Forwarded-For hop share one 'unknown' rate-limit bucket. Not acceptable in production.");
  return true;
};
/**
 * Client IP for rate limiting. The chain is X-Forwarded-For hops followed by the socket peer address.
 * Walk it from the right, skipping hops in TRUSTED_PROXIES (comma-separated env); the first untrusted hop is the client.
 * If the socket peer itself is untrusted (or TRUSTED_PROXIES is empty), X-Forwarded-For is ignored entirely: a direct
 * client can forge any value there. Hops that are not valid IPs end the walk. No usable hop -> "unknown".
 */
const normIp = (x: string | null | undefined): string | null => {
  if (!x) return null;
  let v = x.trim();
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return v.length <= 45 && isIP(v) ? v : null;
};
export const clientIp = (req: Request): string => {
  const trusted = new Set((process.env.TRUSTED_PROXIES ?? "").split(",").map((x) => normIp(x)).filter((x): x is string => !!x));
  const peer = normIp(socketAddr(req));
  if (!peer) return "unknown";
  if (!trusted.has(peer)) return peer;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").slice(-32);
  for (let i = hops.length - 1; i >= 0; i--) {
    const h = normIp(hops[i]);
    if (!h) break;
    if (!trusted.has(h)) return h;
  }
  return peer;
};

/** Housekeeping: drop windows older than a day. Safe to call from anywhere. */
/** Retention of the realtime change feed (sync_events, presence): SECURITY DEFINER function, 7 days by default. */
export const purgeSync = (sql: postgres.Sql) => sql`select purge_sync_events()`;
export const purgeOld = (sql: postgres.Sql) => sql`delete from rate_limits where window_start < now() - interval '1 day'`;


export const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Schedules purgeOld: once now, then every PURGE_INTERVAL_MS. The timer is unref'd (never keeps the process alive) and a failed
 * purge is logged, never thrown. Safe with several app instances: the delete is idempotent. Returns a stop function.
 */
export const startPurgeScheduler = (
  sql: postgres.Sql,
  opts: { intervalMs?: number; log?: (m: string) => void } = {},
): (() => void) => {
  const log = opts.log ?? ((m: string) => console.error(m));
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const run = () => {
    void Promise.resolve(purgeOld(sql)).catch((e: unknown) => log(`[mini-linear] rate_limits purge failed: ${msg(e)}`));
    void Promise.resolve(purgeSync(sql)).catch((e: unknown) => log(`[mini-linear] sync_events purge failed: ${msg(e)}`));
  };
  run();
  const timer = setInterval(run, opts.intervalMs ?? PURGE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};
