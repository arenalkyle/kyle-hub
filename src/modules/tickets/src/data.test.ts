import { describe, expect, it } from "vitest";
import { defaultData, mergeData } from "./data";
import { normalizeFolder, validateFolder, validatePrefix } from "./settings/validate";
import { baseFileContent, markerContent } from "./settings/bootstrap";

describe("mergeData", () => {
  it("fills defaults for null/partial data", () => {
    expect(mergeData(null)).toEqual(defaultData());
    const m = mergeData({ settings: { prefix: "ABC" }, idCounter: 5 });
    expect(m.settings.prefix).toBe("ABC");
    expect(m.settings.folder).toBe("Tickets");
    expect(m.idCounter).toBe(5);
    expect(m.setupDone).toBe(false);
    expect(m.views).toEqual({});
  });
});

describe("validation", () => {
  it("prefix", () => {
    expect(validatePrefix("TIX")).toBeNull();
    expect(validatePrefix("tix")).not.toBeNull();
    expect(validatePrefix("1AB")).not.toBeNull();
    expect(validatePrefix("ABCDEFGHIJK")).not.toBeNull();
  });
  it("folder", () => {
    expect(normalizeFolder(" /A//B/ ")).toBe("A/B");
    expect(validateFolder("Tickets")).toBeNull();
    expect(validateFolder("")).not.toBeNull();
    expect(validateFolder("a/../b")).not.toBeNull();
    expect(validateFolder("a:b")).not.toBeNull();
  });
});

describe("bootstrap content", () => {
  it("base and marker", () => {
    expect(baseFileContent("My/T")).toContain('file.inFolder("My/T/Issues")');
    expect(JSON.parse(markerContent("TIX"))).toEqual({ prefix: "TIX", version: 1 });
  });
});
