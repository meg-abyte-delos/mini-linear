import { describe, it, expect } from "vitest";
import { computeBurndown, type BurnEvent, type BurnIssue } from "../../src/lib/cycles/burndown";

const C = { id: "c1", start_date: "2026-10-26", end_date: "2026-10-30" };
const iss = (id: string, over: Partial<BurnIssue> = {}): BurnIssue => ({ id, created_at: "2026-10-20T10:00:00.000Z", updated_at: "2026-10-20T10:00:00.000Z", status: "todo", cycle_id: "c1", ...over });
const ev = (issue_id: string, at: string, diff: BurnEvent["diff"]): BurnEvent => ({ issue_id, at, diff });

describe("computeBurndown", () => {
  it("no history: in scope since creation, open issues stay remaining, ideal is linear to 0", () => {
    const p = computeBurndown(C, [iss("a"), iss("b")], [], "2026-10-28");
    expect(p.map((x) => x.day)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(p.slice(0, 3).map((x) => [x.scope, x.done, x.remaining])).toEqual([[2, 0, 2], [2, 0, 2], [2, 0, 2]]);
    expect(p.map((x) => x.ideal)).toEqual([2, 1.5, 1, 0.5, 0]);
    expect(p[3]).toMatchObject({ scope: null, done: null, remaining: null });
  });
  it("no history but already done: closed from its last update", () => {
    const p = computeBurndown(C, [iss("a", { status: "done", updated_at: "2026-10-27T09:00:00.000Z" })], [], "2026-10-29");
    expect(p.slice(0, 4).map((x) => x.done)).toEqual([0, 1, 1, 1]);
  });
  it("empty cycle: finite zeros, no NaN", () => {
    const p = computeBurndown(C, [], [], "2026-10-30");
    expect(p.every((x) => x.scope === 0 && x.done === 0 && x.ideal === 0)).toBe(true);
  });
  it("replays status, scope creep, cancel, and moves in and out of the cycle", () => {
    const issues = [
      iss("a", { status: "done" }), // done on the 27th
      iss("b", { status: "canceled" }), // canceled on the 28th
      iss("c", { created_at: "2026-10-28T08:00:00.000Z", cycle_id: "c1" }), // added mid-cycle
      iss("d", { cycle_id: "c2" }), // moved out on the 28th
    ];
    const events = [
      ev("a", "2026-10-27T10:00:00.000Z", { status: { before: "todo", after: "done" } }),
      ev("b", "2026-10-28T10:00:00.000Z", { status: { before: "todo", after: "canceled" } }),
      ev("c", "2026-10-28T08:00:00.000Z", { cycle_id: { before: null, after: "c1" }, status: { before: null, after: "todo" } }),
      ev("d", "2026-10-28T11:00:00.000Z", { cycle_id: { before: "c1", after: "c2" } }),
    ];
    const p = computeBurndown(C, issues, events, "2026-10-29");
    expect(p.slice(0, 4).map((x) => [x.scope, x.done])).toEqual([[3, 0], [3, 1], [2, 1], [2, 1]]);
    expect(p[0]!.ideal).toBe(3);
  });
  it("single-day cycle", () => {
    const p = computeBurndown({ id: "c1", start_date: "2026-10-26", end_date: "2026-10-26" }, [iss("a")], [], "2026-10-26");
    expect(p).toEqual([{ day: "2026-10-26", scope: 1, done: 0, remaining: 1, ideal: 0 }]);
  });
});
