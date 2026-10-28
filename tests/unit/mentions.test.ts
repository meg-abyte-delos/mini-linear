import { describe, it, expect } from "vitest";
import { parseMentions, normalizeEmoji, MAX_MENTIONS } from "../../src/lib/comments/mentions";

const U = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
describe("parseMentions", () => {
  it("parses explicit @[label](uuid) and lowercases ids", () => {
    expect(parseMentions(`hi @[Ada Kernel](${U.toUpperCase()}) ok`)).toEqual({ ids: [U], handles: [] });
  });
  it("ignores explicit mentions with a non-uuid target, and does not re-read them as handles", () => {
    expect(parseMentions("@[x](not-a-uuid)")).toEqual({ ids: [], handles: [] });
  });
  it("parses @handle, dedupes, strips trailing punctuation", () => {
    expect(parseMentions("@Ada, @ada. and @linus.patch!").handles).toEqual(["ada", "linus.patch"]);
  });
  it("does not treat emails or mid-word @ as mentions", () => {
    expect(parseMentions("mail ada@delos.so or foo@bar").handles).toEqual([]);
  });
  it("ignores mentions in inline code and fenced blocks", () => {
    expect(parseMentions("`@ada` and\n```\n@rex\n```\n@tess").handles).toEqual(["tess"]);
  });
  it("caps the number of mentions", () => {
    const body = Array.from({ length: 80 }, (_, i) => `@u${i}`).join(" ");
    expect(parseMentions(body).handles).toHaveLength(MAX_MENTIONS);
  });
});
describe("normalizeEmoji", () => {
  it("accepts unicode emoji, ZWJ sequences and flags", () => {
    for (const e of ["👍", "👩‍💻", "🇫🇷", "❤️"]) expect(normalizeEmoji(e)).toBe(e);
  });
  it("accepts and lowercases :shortcodes:", () => { expect(normalizeEmoji(" :Tada: ")).toBe(":tada:"); });
  it("rejects text, whitespace, empty and long input", () => {
    for (const e of ["", "abc", "👍 👍", "<script>", "x".repeat(40), ":a b:"]) expect(normalizeEmoji(e)).toBeNull();
  });
});
