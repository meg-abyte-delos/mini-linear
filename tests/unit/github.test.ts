import { describe, it, expect } from "vitest";
import { verifySignature, sign, extractIssueRefs, nextStatus, classify } from "../../src/lib/integrations/github";

describe("github: HMAC signature", () => {
  const s = "x".repeat(64), body = '{"a":1}';
  it("accepts the exact signature, constant-time, and nothing else", () => {
    expect(verifySignature(s, body, sign(s, body))).toBe(true);
    expect(verifySignature(s, Buffer.from(body), sign(s, body))).toBe(true);
    expect(verifySignature(s, body + " ", sign(s, body))).toBe(false);
    expect(verifySignature("y".repeat(64), body, sign(s, body))).toBe(false);
    expect(verifySignature(s, body, null)).toBe(false);
    expect(verifySignature(s, body, "sha1=abc")).toBe(false);
    expect(verifySignature(s, body, "sha256=" + "0".repeat(63))).toBe(false);
    expect(verifySignature(s, body, "sha256=" + "z".repeat(64))).toBe(false);
  });
  it("matches GitHub's documented test vector", () => {
    // docs.github.com > Validating webhook deliveries: secret "It's a Secret to Everybody", payload "Hello, World!"
    expect(sign("It's a Secret to Everybody", "Hello, World!")).toBe("sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17");
  });
});

describe("github: issue reference extraction", () => {
  it("branch key closes, case-insensitive, with prefixes", () => {
    expect(extractIssueRefs({ branch: "alice/eng-123-fix-login" })).toEqual([{ key: "ENG", number: 123, via: "branch", closes: true }]);
    expect(extractIssueRefs({ branch: "ENG-7" })[0]).toMatchObject({ key: "ENG", number: 7 });
    expect(extractIssueRefs({ branch: "feature-login" })).toEqual([]);
    expect(extractIssueRefs({ branch: "abcdeng-12" })).toEqual([]); // 7 letters: not a key, no partial match
  });
  it("magic words close, lists supported, bare mentions only link", () => {
    const r = extractIssueRefs({ title: "Login", body: "Fixes ENG-1, ENG-2 and ops-3\nResolves: DES-9\nrelated to ENG-4" });
    const by = Object.fromEntries(r.map((x) => [`${x.key}-${x.number}`, x]));
    expect(by["ENG-1"]).toMatchObject({ via: "magic_word", closes: true });
    expect(by["ENG-2"]).toMatchObject({ via: "magic_word", closes: true });
    expect(by["OPS-3"]).toMatchObject({ via: "magic_word", closes: true });
    expect(by["DES-9"]).toMatchObject({ via: "magic_word", closes: true });
    expect(by["ENG-4"]).toMatchObject({ via: "mention", closes: false });
  });
  it("all magic word variants; strongest reason wins; dedup", () => {
    for (const w of ["close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved", "Completes"])
      expect(extractIssueRefs({ body: `${w} ENG-5` })[0]).toMatchObject({ via: "magic_word" });
    const r = extractIssueRefs({ branch: "eng-5-x", title: "ENG-5", body: "fixes ENG-5" });
    expect(r).toEqual([{ key: "ENG", number: 5, via: "branch", closes: true }]);
    expect(extractIssueRefs({ body: "prefix ENG-0 and ENG-123456789012" })).toEqual([]);
  });
});

describe("github: transitions", () => {
  it("only moves forward, never touches canceled, never cancels", () => {
    expect(nextStatus("todo", "in_progress")).toBe("in_progress");
    expect(nextStatus("backlog", "done")).toBe("done");
    expect(nextStatus("in_review", "in_progress")).toBeNull();
    expect(nextStatus("done", "in_progress")).toBeNull();
    expect(nextStatus("canceled", "done")).toBeNull();
    expect(nextStatus("todo", "canceled")).toBeNull();
    expect(nextStatus("todo", null)).toBeNull();
  });
  it("classifies pull_request actions", () => {
    expect(classify("opened", { state: "open" })).toEqual({ state: "open", trigger: "open" });
    expect(classify("opened", { state: "open", draft: true })).toEqual({ state: "draft", trigger: null });
    expect(classify("ready_for_review", { state: "open" })).toEqual({ state: "open", trigger: "open" });
    expect(classify("review_requested", { state: "open" })).toEqual({ state: "open", trigger: "review" });
    expect(classify("closed", { state: "closed", merged: true })).toEqual({ state: "merged", trigger: "merge" });
    expect(classify("closed", { state: "closed", merged: false })).toEqual({ state: "closed", trigger: null });
    expect(classify("edited", { state: "open" })).toEqual({ state: "open", trigger: null });
    expect(classify("labeled", { state: "open" })).toBeNull();
  });
});
