import { describe, it, expect } from "vitest";
import { between } from "../../src/lib/issues/sortkey";

describe("between", () => {
  it("is strictly between, for open and tight ends", () => {
    const cases: [string | null, string | null][] = [[null, null], ["a", null], [null, "a"], ["a", "b"], ["a", "a1"], ["az", "b"], ["0", "1"], ["abc", "abd"], ["zz", null], [null, "01"]];
    for (const [lo, hi] of cases) {
      const k = between(lo, hi);
      if (lo !== null) expect(k > lo).toBe(true);
      if (hi !== null) expect(k < hi).toBe(true);
    }
  });
  it("can be applied repeatedly (always splitting the same gap)", () => {
    const lo = "m"; let hi = "n";
    for (let i = 0; i < 40; i++) { const k = between(lo, hi); expect(k > lo && k < hi).toBe(true); hi = k; }
  });
  it("rejects an empty range", () => { expect(() => between("b", "a")).toThrow(); expect(() => between("a", "a")).toThrow(); });
});
