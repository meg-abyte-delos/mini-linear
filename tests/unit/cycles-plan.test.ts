import { describe, it, expect } from "vitest";
import { planCycles, fillBurn, addDays, weekday } from "../../src/lib/cycles/plan";

const S = { duration_days: 14, cooldown_days: 0, start_weekday: 1, upcoming_count: 2 };
describe("planCycles", () => {
  it("first cycle starts on the latest start weekday on or before today (Mon 2026-10-26)", () => {
    const p = planCycles([], S, "2026-10-28"); // Wednesday
    expect(p[0]).toEqual({ start_date: "2026-10-26", end_date: "2026-11-08" });
    expect(weekday(p[0]!.start_date)).toBe(1);
    expect(p).toHaveLength(3); // current + 2 upcoming
    expect(p[1]!.start_date).toBe("2026-11-09");
  });
  it("is idempotent once the schedule is filled", () => {
    const p = planCycles([], S, "2026-10-28");
    expect(planCycles(p, S, "2026-10-28")).toEqual([]);
  });
  it("tops up as time passes", () => {
    const p = planCycles([], S, "2026-10-28");
    const more = planCycles(p, S, "2026-11-10");
    expect(more).toHaveLength(1);
    expect(more[0]!.start_date).toBe("2026-12-07");
  });
  it("applies cooldown between cycles", () => {
    const p = planCycles([], { ...S, duration_days: 7, cooldown_days: 7 }, "2026-10-28");
    expect(p[1]!.start_date).toBe("2026-11-09");
  });
  it("skips a first cycle already over (short cycle, start weekday earlier in week)", () => {
    const p = planCycles([], { ...S, duration_days: 2, start_weekday: 1, upcoming_count: 1 }, "2026-10-30");
    expect(p.every((c) => c.end_date >= "2026-10-30" || c.start_date > "2026-10-30")).toBe(true);
    expect(p.some((c) => c.start_date > "2026-10-30")).toBe(true);
  });
  it("continues after the last existing cycle even when the gap is old", () => {
    const p = planCycles([{ start_date: "2026-01-05", end_date: "2026-01-18" }], S, "2026-10-28");
    expect(p[0]!.start_date).toBe("2026-01-19");
    expect(p.length).toBeGreaterThan(10);
  });
});
describe("fillBurn", () => {
  it("carries forward missing days up to today", () => {
    const r = fillBurn([{ day: "2026-10-26", scope: 3, started: 1, completed: 0 }, { day: "2026-10-28", scope: 4, started: 1, completed: 2 }], "2026-10-26", "2026-11-08", "2026-10-29");
    expect(r.map((x) => [x.day, x.scope, x.completed])).toEqual([["2026-10-26", 3, 0], ["2026-10-27", 3, 0], ["2026-10-28", 4, 2], ["2026-10-29", 4, 2]]);
  });
  it("addDays crosses month ends", () => expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
});
