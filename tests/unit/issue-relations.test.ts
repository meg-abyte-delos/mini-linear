import { describe, it, expect } from "vitest";
import { canonical, view } from "../../src/lib/issues/relations";

const A = "00000000-0000-7000-8000-00000000000a", B = "00000000-0000-7000-8000-00000000000b";
describe("issue relations canonical form", () => {
  it("blocked_by is stored as the inverse blocks", () => {
    expect(canonical("blocked_by", A, B)).toEqual({ type: "blocks", issue_id: B, related_issue_id: A });
    expect(canonical("blocks", A, B)).toEqual({ type: "blocks", issue_id: A, related_issue_id: B });
  });
  it("related is symmetric and ordered", () => {
    expect(canonical("related", B, A)).toEqual(canonical("related", A, B));
    expect(canonical("related", B, A).issue_id).toBe(A);
  });
  it("duplicate keeps direction", () => {
    expect(canonical("duplicate", B, A)).toEqual({ type: "duplicate", issue_id: B, related_issue_id: A });
  });
  it("view derives blocked_by and always puts self first", () => {
    const row = { id: "r", type: "blocks", issue_id: A, related_issue_id: B };
    expect(view(row, A)).toMatchObject({ type: "blocks", issue_id: A, related_issue_id: B, direction: "outgoing" });
    expect(view(row, B)).toMatchObject({ type: "blocked_by", issue_id: B, related_issue_id: A, direction: "incoming" });
    expect(view({ ...row, type: "related" }, B)).toMatchObject({ type: "related", related_issue_id: A, direction: "both" });
    expect(view({ ...row, type: "duplicate" }, B)).toMatchObject({ type: "duplicate", direction: "incoming" });
  });
});
