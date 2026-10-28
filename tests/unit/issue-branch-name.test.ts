import { describe, it, expect } from "vitest";
import { branchName, slugify, handleOf } from "../../src/lib/issues/handlers";

describe("branch_name (Linear format)", () => {
  it("formats <user>/<team-lower>-<n>-<slug>", () => {
    expect(branchName("meg", "ENG", 42, "Fix login: crash on Safari!")).toBe("meg/eng-42-fix-login-crash-on-safari");
  });
  it("strips accents and collapses separators", () => {
    expect(slugify("  Écran   d'accueil -- été ")).toBe("ecran-d-accueil-ete");
  });
  it("caps the title slug at 60 chars without a trailing dash", () => {
    const b = branchName("a", "T", 1, "word ".repeat(40));
    const slug = b.split("/")[1]!.replace(/^t-1-/, "");
    expect(slug.length).toBeLessThanOrEqual(60); expect(slug.endsWith("-")).toBe(false);
  });
  it("handles empty / symbol-only titles and handles", () => {
    expect(branchName("", "ENG", 3, "!!!")).toBe("user/eng-3");
    expect(branchName("Jean.Dupont+x", "ENG", 3, "a")).toBe("jean-dupont-x/eng-3-a");
  });
  it("derives the handle from the email local part", () => { expect(handleOf("meg.abyte@x.io")).toBe("meg.abyte"); });
});
