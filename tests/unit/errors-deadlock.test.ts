import { describe, it, expect } from "vitest";
import { errorResponse, isDeadlock } from "../../src/lib/http/errors";

describe("40P01 deadlock", () => {
  it("is detected", () => { expect(isDeadlock({ code: "40P01" })).toBe(true); expect(isDeadlock({ code: "23505" })).toBe(false); });
  it("maps to 409 conflict", async () => {
    const r = errorResponse({ code: "40P01" });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("conflict");
  });
});
