import { describe, expect, it } from "vitest";
import { classifyGhError, parseGhUser, parseGhVersion, runGh } from "./gh";

describe("gh helpers", () => {
  it("classifies errors", () => {
    expect(classifyGhError({ code: "ENOENT" }, "")).toBe("not-installed");
    expect(classifyGhError({ killed: true }, "")).toBe("timeout");
    expect(classifyGhError({ code: 1 }, "To get started with GitHub CLI, please run:  gh auth login")).toBe("not-authenticated");
    expect(classifyGhError({ code: 1 }, "GraphQL: Could not resolve to a PullRequest with the number of 9")).toBe("not-found");
    expect(classifyGhError({ code: 1 }, "boom")).toBe("other");
  });
  it("parses version and user", () => {
    expect(parseGhVersion("gh version 2.62.0 (2024-11-14)\nhttps://x")).toBe("2.62.0");
    expect(parseGhUser("github.com\n  ✓ Logged in to github.com account octo (keyring)")).toBe("octo");
  });
  it("rejects with not-installed for a missing binary (no shell)", async () => {
    await expect(runGh(["--version"], { bin: "definitely-not-a-real-gh-binary" })).rejects.toMatchObject({ kind: "not-installed" });
  });
});
