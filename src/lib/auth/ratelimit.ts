import type postgres from "postgres";
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
/**
 * TODO(prod): the shared "unknown" bucket must not reach production. The host adapter MUST call setSocketAddrResolver.
 * Called at startup (src/instrumentation.ts); warns loudly when no resolver is set. Returns true if a warning was emitted.
 */
export const warnIfNoSocketResolver = (log: (m: string) => void = (m) => console.warn(m)): boolean => {
  if (socketResolverSet) return false;
  log("[mini-linear] WARNING: setSocketAddrResolver is not set; requests without a trusted X-Forwarded-For hop share one 'unknown' rate-limit bucket. Not acceptable in production.");
  return true;
};
/**
 * Client IP for rate limiting. X-Forwarded-For is client-controlled on its left side, so the FIRST hop is never used:
 * walk the list from the right and take the first hop not in TRUSTED_PROXIES (comma-separated env); each trusted proxy
 * appended the address it saw, so the first untrusted one from the right is the real peer. No usable hop -> socket address -> "unknown".
 */
export const clientIp = (req: Request): string => {
  const trusted = new Set((process.env.TRUSTED_PROXIES ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!trusted.has(hops[i]!)) return hops[i]!;
  return socketAddr(req) ?? "unknown";
};

/** Housekeeping: drop windows older than a day. Safe to call from anywhere. */
export const purgeOld = (sql: postgres.Sql) => sql`delete from rate_limits where window_start < now() - interval '1 day'`;
