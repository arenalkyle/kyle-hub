import { describe, expect, it } from "vitest";
import { around } from "./around";

describe("around", () => {
  const make = () => {
    const calls: string[] = [];
    const obj: Record<string, unknown> = { f: () => (calls.push("orig"), "orig") };
    return { obj, calls };
  };
  it("wraps and restores when still on top", () => {
    const { obj, calls } = make();
    const orig = obj.f;
    const un = around(obj, "f", (old) => () => (calls.push("wrap"), old()));
    (obj.f as () => unknown)();
    expect(calls).toEqual(["wrap", "orig"]);
    un();
    expect(obj.f).toBe(orig);
  });
  it("becomes a pass-through when another wrapper sits on top", () => {
    const { obj, calls } = make();
    const un = around(obj, "f", (old) => () => (calls.push("wrap"), old()));
    const ours = obj.f as () => unknown;
    obj.f = () => (calls.push("other"), ours());
    un();
    expect((obj.f as () => unknown)()).toBe("orig");
    expect(calls).toEqual(["other", "orig"]);
  });
});
