import { describe, it, expect } from "vitest";
import { warnIfNoSocketResolver, setSocketAddrResolver } from "../../src/lib/auth/ratelimit";

describe("startup warning", () => {
  it("warns while setSocketAddrResolver is unset, then stays quiet", () => {
    const logs: string[] = [];
    expect(warnIfNoSocketResolver((m) => logs.push(m))).toBe(true);
    expect(logs[0]).toMatch(/setSocketAddrResolver/);
    setSocketAddrResolver(() => "1.1.1.1");
    expect(warnIfNoSocketResolver((m) => logs.push(m))).toBe(false);
    expect(logs).toHaveLength(1);
  });
});
