import { describe, it, expect, beforeEach } from "vitest";
import { warnIfNoSocketResolver, setSocketAddrResolver, resetSocketAddrResolverForTests } from "../../src/lib/auth/ratelimit";

describe("startup check for setSocketAddrResolver", () => {
  beforeEach(() => resetSocketAddrResolverForTests());

  it("warns in dev/test while unset, then stays quiet once set", () => {
    const logs: string[] = [];
    expect(warnIfNoSocketResolver((m) => logs.push(m), "development")).toBe(true);
    expect(warnIfNoSocketResolver((m) => logs.push(m), "test")).toBe(true);
    expect(logs[0]).toMatch(/setSocketAddrResolver/);
    setSocketAddrResolver(() => "1.1.1.1");
    expect(warnIfNoSocketResolver((m) => logs.push(m), "development")).toBe(false);
    expect(logs).toHaveLength(2);
  });

  it("throws in production when unset (fail closed)", () => {
    const logs: string[] = [];
    expect(() => warnIfNoSocketResolver((m) => logs.push(m), "production")).toThrow(/setSocketAddrResolver/);
    expect(logs).toHaveLength(0);
  });

  it("does not throw in production once a resolver is set", () => {
    setSocketAddrResolver(() => "1.1.1.1");
    expect(warnIfNoSocketResolver(() => {}, "production")).toBe(false);
  });
});
