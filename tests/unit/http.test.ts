import { describe, it, expect } from "vitest";
import { z } from "zod";
import { encodeCursor, decodeCursor, page } from "../../src/lib/http/cursor";
import { ApiError, errorResponse } from "../../src/lib/http/errors";
import { ifMatchVersion, parseId, parseQuery, listQuery } from "../../src/lib/http/validate";
import { diffOf } from "../../src/lib/audit";

const W = "11111111-1111-1111-1111-111111111111", W2 = "22222222-2222-2222-2222-222222222222";
describe("cursor", () => {
  it("round-trips", () => expect(decodeCursor(encodeCursor(W, "issues", { k: "5", id: "x" }), W, "issues")).toEqual({ k: "5", id: "x" }));
  it("rejects tampering, other workspace, other scope, garbage", () => {
    const c = encodeCursor(W, "issues", { k: "5", id: "x" });
    const [b, s] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ w: W, s: "issues", k: "999", id: "x" })).toString("base64url");
    for (const bad of [`${forged}.${s}`, `${b}.AAAA`, "nope", "a.b.c", ""]) expect(() => decodeCursor(bad, W, "issues")).toThrow(ApiError);
    expect(() => decodeCursor(c, W2, "issues")).toThrow(ApiError);
    expect(() => decodeCursor(c, W, "projects")).toThrow(ApiError);
  });
  it("page() sets next_cursor only when more rows exist", () => {
    const rows = [1, 2, 3].map((n) => ({ id: String(n) }));
    const p = page(rows, 2, W, "s", (r) => ({ k: r.id, id: r.id }));
    expect(p.items).toHaveLength(2);
    expect(decodeCursor(p.next_cursor!, W, "s").id).toBe("2");
    expect(page(rows, 3, W, "s", (r) => ({ k: r.id, id: r.id })).next_cursor).toBeNull();
  });
});
describe("validate", () => {
  const r = (h?: string) => new Request("http://x/", { headers: h ? { "if-match": h } : {} });
  it("If-Match", () => {
    expect(ifMatchVersion(r('"3"'))).toBe(3); expect(ifMatchVersion(r('W/"4"'))).toBe(4); expect(ifMatchVersion(r("5"))).toBe(5);
    expect(() => ifMatchVersion(r())).toThrow(/If-Match required/);
    expect(() => ifMatchVersion(r("abc"))).toThrow(ApiError);
  });
  it("list query defaults and bounds", () => {
    expect(parseQuery(new Request("http://x/?"), listQuery).limit).toBe(50);
    expect(() => parseQuery(new Request("http://x/?limit=101"), listQuery)).toThrow();
  });
  it("malformed id is 404", () => { expect(() => parseId("zz")).toThrow(ApiError); const u = "0192f0a1-7b3c-7d4e-8f5a-6b7c8d9e0f1a"; expect(parseId(u)).toBe(u); });
});
describe("errors", () => {
  it("maps statuses and hides internals", async () => {
    expect(errorResponse(new ApiError("not_found")).status).toBe(404);
    expect(errorResponse(new ApiError("precondition_failed")).status).toBe(412);
    expect(errorResponse(z.object({ a: z.string() }).safeParse({}).error!).status).toBe(422);
    const ir = errorResponse(new Error("secret db password"));
    expect(ir.status).toBe(500); expect(JSON.stringify(await ir.json())).not.toContain("secret");
  });
});
describe("audit diff", () => {
  it("only changed fields, drops secrets", () => {
    expect(diffOf({ a: 1, b: 2, password_hash: "x" }, { a: 1, b: 3, password_hash: "y" }, ["a", "b", "password_hash"])).toEqual({ b: { before: 2, after: 3 } });
  });
});
