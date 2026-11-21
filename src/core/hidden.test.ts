import { describe, expect, it } from "vitest";
import { defaultDisplay, mergeDisplay } from "./display";
import { hiddenFor, sanitizeHidden, toggleHidden, visibleGroups } from "./hidden";

describe("hidden groups", () => {
  it("hides and shows per grouping field", () => {
    let h = toggleHidden({}, "status", "status:Done", true);
    h = toggleHidden(h, "priority", "p:1", true);
    expect(hiddenFor(h, "status")).toEqual(["status:Done"]);
    expect(hiddenFor(h, "priority")).toEqual(["p:1"]);
    h = toggleHidden(h, "status", "status:Done", false);
    expect(h).toEqual({ priority: ["p:1"] });
    expect(hiddenFor(h, "none")).toEqual([]);
  });
  it("does not duplicate keys", () => {
    const h = toggleHidden(toggleHidden({}, "status", "a", true), "status", "a", true);
    expect(h.status).toEqual(["a"]);
  });
  it("filters groups", () => {
    const gs = [{ key: "a" }, { key: "b" }];
    expect(visibleGroups(gs, ["a"])).toEqual([{ key: "b" }]);
    expect(visibleGroups(gs, [])).toEqual(gs);
  });
  it("sanitizes junk", () => {
    expect(sanitizeHidden(null)).toEqual({});
    expect(sanitizeHidden({ status: ["a", 1, "a"], x: "no", y: [] })).toEqual({ status: ["a"] });
  });
  it("old saved display state loads with nothing hidden", () => {
    const old: Record<string, unknown> = { ...defaultDisplay() };
    delete old.hiddenGroups;
    expect(mergeDisplay(old).hiddenGroups).toEqual({});
    expect(mergeDisplay({ ...old, hiddenGroups: { status: ["s"] } }).hiddenGroups).toEqual({ status: ["s"] });
  });
});
