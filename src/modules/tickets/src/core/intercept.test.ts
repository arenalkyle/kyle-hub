import { describe, expect, it } from "vitest";
import { interceptTarget, isIssuePath, isProjectPath, shouldIntercept } from "./intercept";
import { relativeTime } from "./time";

describe("shouldIntercept", () => {
  const base = { folder: "Tickets", forcedMarkdown: false };
  it("intercepts ticket files", () => {
    expect(shouldIntercept({ ...base, path: "Tickets/Issues/TIX-12.md" })).toBe(true);
  });
  it("tolerates slashes around the folder setting", () => {
    expect(shouldIntercept({ ...base, folder: "/Tickets/", path: "Tickets/Issues/TIX-1.md" })).toBe(true);
  });
  it("ignores other folders, nested paths and other extensions", () => {
    expect(shouldIntercept({ ...base, path: "Notes/TIX-12.md" })).toBe(false);
    expect(shouldIntercept({ ...base, path: "Tickets/Projects/Alpha.md" })).toBe(false);
    expect(shouldIntercept({ ...base, path: "Tickets/Issues/sub/TIX-12.md" })).toBe(false);
    expect(shouldIntercept({ ...base, path: "Tickets/Issues/TIX-12.png" })).toBe(false);
    expect(shouldIntercept({ ...base, path: "Other/Tickets/Issues/TIX-12.md" })).toBe(false);
  });
  it("does not intercept when forced to Markdown", () => {
    expect(shouldIntercept({ ...base, path: "Tickets/Issues/TIX-12.md", forcedMarkdown: true })).toBe(false);
  });
  it("isIssuePath rejects an empty folder", () => {
    expect(isIssuePath("/Issues/a.md", "")).toBe(false);
  });
});

describe("interceptTarget", () => {
  const base = { folder: "Tickets", forcedMarkdown: false };
  it("routes project files to the project view", () => {
    expect(interceptTarget({ ...base, path: "Tickets/Projects/Alpha.md" })).toBe("project");
    expect(interceptTarget({ ...base, folder: "/Tickets/", path: "Tickets/Projects/Alpha.md" })).toBe("project");
  });
  it("routes issues to the issue view and ignores everything else", () => {
    expect(interceptTarget({ ...base, path: "Tickets/Issues/TIX-1.md" })).toBe("issue");
    expect(interceptTarget({ ...base, path: "Tickets/Projects/sub/Alpha.md" })).toBeNull();
    expect(interceptTarget({ ...base, path: "Tickets/Projects/Alpha.png" })).toBeNull();
    expect(interceptTarget({ ...base, path: "Notes/Projects/Alpha.md" })).toBeNull();
  });
  it("respects a forced Markdown leaf", () => {
    expect(interceptTarget({ ...base, path: "Tickets/Projects/Alpha.md", forcedMarkdown: true })).toBeNull();
  });
  it("isProjectPath rejects an empty folder", () => {
    expect(isProjectPath("/Projects/a.md", "")).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 10, 21, 12, 0, 0);
  it("formats ranges", () => {
    expect(relativeTime("2026-11-21T11:59:50", now)).toBe("just now");
    expect(relativeTime("2026-11-21T11:30:00", now)).toBe("30m ago");
    expect(relativeTime("2026-11-21T09:00:00", now)).toBe("3h ago");
    expect(relativeTime("2026-11-18T12:00:00", now)).toBe("3d ago");
    expect(relativeTime("nope", now)).toBeNull();
  });
});
