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
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/** Housekeeping: drop windows older than a day. Safe to call from anywhere. */
export const purgeOld = (sql: postgres.Sql) => sql`delete from rate_limits where window_start < now() - interval '1 day'`;
