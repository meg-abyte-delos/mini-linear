import { describe, it, expect, vi, afterEach } from "vitest";
import type postgres from "postgres";
import { startPurgeScheduler, PURGE_INTERVAL_MS } from "../../src/lib/auth/ratelimit";

const fakeSql = (impl: () => Promise<unknown> = async () => []) => {
  const calls: string[] = [];
  const sql = ((strings: TemplateStringsArray) => { calls.push(strings.join("?")); return impl(); }) as unknown as postgres.Sql;
  return { sql, calls };
};

describe("startPurgeScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("purges at start, then every interval, and stops", () => {
    vi.useFakeTimers();
    const { sql, calls } = fakeSql();
    const stop = startPurgeScheduler(sql);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/delete from rate_limits/);
    expect(calls[1]).toMatch(/purge_sync_events/);
    vi.advanceTimersByTime(PURGE_INTERVAL_MS * 2);
    expect(calls).toHaveLength(6);
    stop();
    vi.advanceTimersByTime(PURGE_INTERVAL_MS * 2);
    expect(calls).toHaveLength(6);
  });

  it("logs a failing purge and keeps running", async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const { sql, calls } = fakeSql(async () => { throw new Error("db down"); });
    const stop = startPurgeScheduler(sql, { intervalMs: 1000, log: (m) => logs.push(m) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(logs[0]).toMatch(/purge failed: db down/);
    expect(logs.some((l) => /sync_events purge failed: db down/.test(l))).toBe(true);
    stop();
  });
});
