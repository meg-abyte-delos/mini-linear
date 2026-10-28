import { describe, it, expect } from "vitest";
import { estimateOptions, estimateValues, ESTIMATE_MAX, ESTIMATE_SCALES } from "../../src/lib/team-config";
describe("team-config", () => {
  it("estimate scales", () => {
    expect(estimateValues("none")).toEqual([]);
    expect(estimateValues("fibonacci")).toEqual([1, 2, 3, 5, 8]);
    expect(estimateValues("exponential", true)).toEqual([0, 1, 2, 4, 8, 16]);
    expect(estimateValues("linear", true)[0]).toBe(0);
    expect(estimateOptions("tshirt", true).map((o) => o.label)).toEqual(["XS", "S", "M", "L", "XL"]);
    expect(estimateValues("tshirt", true)).toEqual([1, 2, 3, 5, 8]);
  });
  it("every offered value fits the issues.estimate range (integer 0..64)", () => {
    for (const s of ESTIMATE_SCALES) for (const v of estimateValues(s, true)) {
      expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(ESTIMATE_MAX);
    }
  });
});
