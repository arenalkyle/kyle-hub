import { describe, expect, it } from "vitest";
import { formatAge, resolveTitle } from "../src/title";

describe("resolveTitle", () => {
  const profileName = "PowerShell 5.1";
  it("manual beats osc beats profile", () => {
    expect(resolveTitle({ manual: "Mine", osc: "Task", profileName })).toBe("Mine");
    expect(resolveTitle({ osc: "Task", profileName })).toBe("Task");
    expect(resolveTitle({ profileName })).toBe(profileName);
  });
  it("blank manual/osc fall through (clearing the name unpins)", () => {
    expect(resolveTitle({ manual: "  ", osc: "Task", profileName })).toBe("Task");
    expect(resolveTitle({ manual: "", osc: "", profileName })).toBe(profileName);
  });
  it("first prompt sits between osc and profile", () => {
    expect(resolveTitle({ firstPrompt: "fix bug", profileName })).toBe("fix bug");
    expect(resolveTitle({ osc: "Task", firstPrompt: "fix bug", profileName })).toBe("Task");
  });
});

describe("resolveTitle Claude fallback", () => {
  const profileName = "PowerShell 5.1";
  it("falls back to Claude instead of the profile name", () => {
    expect(resolveTitle({ profileName, claude: true })).toBe("Claude");
    expect(resolveTitle({ profileName, claude: false })).toBe(profileName);
  });
  it("keeps manual > osc > first prompt above the Claude fallback", () => {
    expect(resolveTitle({ manual: "Mine", osc: "T", firstPrompt: "p", profileName, claude: true })).toBe("Mine");
    expect(resolveTitle({ osc: "T", firstPrompt: "p", profileName, claude: true })).toBe("T");
    expect(resolveTitle({ firstPrompt: "p", profileName, claude: true })).toBe("p");
  });
});

describe("formatAge", () => {
  it("formats units", () => {
    expect(formatAge(5000)).toBe("5s");
    expect(formatAge(12 * 60_000)).toBe("12m");
    expect(formatAge(3 * 3_600_000)).toBe("3h");
    expect(formatAge(2 * 86_400_000)).toBe("2d");
    expect(formatAge(-5)).toBe("0s");
  });
});
