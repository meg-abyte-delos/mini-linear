import { describe, it, expect } from "vitest";
import { uuidv7 } from "../../src/lib/uuid7";

describe("uuidv7", () => {
  it("has version 7, variant 10 and the given ms timestamp in the first 48 bits", () => {
    const t = 1_761_600_000_123;
    const id = uuidv7(t);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(t);
  });
  it("is unique and time-ordered across ms", () => {
    const a = uuidv7(1000), b = uuidv7(2000);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => uuidv7())).size).toBe(1000);
  });
});
