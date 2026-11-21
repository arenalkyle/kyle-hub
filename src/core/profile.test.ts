import { describe, expect, it } from "vitest";
import { checkProfileMatch, vaultProfileOf } from "./profile";

describe("vault profile", () => {
  it("defaults to home and ignores junk", () => {
    expect(vaultProfileOf(undefined)).toBe("home");
    expect(vaultProfileOf({ profile: "nope" })).toBe("home");
    expect(vaultProfileOf({ profile: "work" })).toBe("work");
  });

  it("guard names both profiles on mismatch", () => {
    expect(checkProfileMatch("work", "work", "r").ok).toBe(true);
    const g = checkProfileMatch("work", "home", "my-repo");
    expect(g.ok).toBe(false);
    expect(g.message).toContain("home");
    expect(g.message).toContain("work");
    expect(g.message).toContain("my-repo");
  });
});
