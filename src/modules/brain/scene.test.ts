import { describe, expect, it } from "vitest";
import { buildGraph } from "../../core/domain/brainGraph";
import { layoutFor } from "./scene";
import { brainOptions } from "./source";

describe("layoutFor", () => {
  it("reuses cached positions and only places new nodes; prunes deleted ones", () => {
    const cache = new Map<string, [number, number, number]>();
    const g1 = buildGraph(["a.md", "b.md"], { "a.md": { "b.md": 1 } });
    layoutFor(g1, cache);
    const a = [...cache.get("a.md")!];
    const g2 = buildGraph(["a.md", "b.md", "c.md"], { "a.md": { "b.md": 1 }, "c.md": { "a.md": 1 } });
    const pos = layoutFor(g2, cache);
    expect(cache.get("a.md")).toEqual(a);
    expect(pos.length).toBe(9);
    expect(cache.has("c.md")).toBe(true);
    layoutFor(buildGraph(["a.md"], {}), cache);
    expect([...cache.keys()]).toEqual(["a.md"]);
  });
});

describe("brainOptions", () => {
  it("clamps and defaults", () => {
    expect(brainOptions({})).toEqual({ bloom: 1.1, nodeSize: 1, theme: "multiverse", shape: "brain", rotateSpeed: 0.3, orbitMode: "drift", orbitColor: "default", orbitOpacity: 0.35, orbitSpeed: 1, toasts: true });
    expect(brainOptions({ orbitMode: "solar", orbitColor: "#aabbcc", orbitOpacity: 5 })).toMatchObject({ orbitMode: "solar", orbitColor: "#aabbcc", orbitOpacity: 1 });
    expect(brainOptions({ orbitSpeed: 9 }).orbitSpeed).toBe(2);
    expect(brainOptions({ bloomStrength: 9, nodeSize: -1 })).toMatchObject({ bloom: 3, nodeSize: 0.4 });
    expect(brainOptions({ theme: "inkblot", shape: "galaxy", rotateSpeed: 7 })).toMatchObject({ theme: "inkblot", shape: "galaxy", rotateSpeed: 1 });
    expect(brainOptions({ theme: "x", shape: "x", rotateSpeed: "x" })).toMatchObject({ theme: "multiverse", shape: "brain", rotateSpeed: 0.3 });
  });
});
