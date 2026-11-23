import { describe, expect, it } from "vitest";
import { BRAIN_THEMES, mixHex, nebulaColors, themeById } from "./brainTheme";

describe("brain themes", () => {
  it("has the ten Hivemynd themes with valid colours and unique ids", () => {
    expect(BRAIN_THEMES).toHaveLength(10);
    expect(new Set(BRAIN_THEMES.map((t) => t.id)).size).toBe(10);
    for (const t of BRAIN_THEMES) for (const c of [t.bg, t.node, t.link, t.accent, ...nebulaColors(t)]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it("only Inkblot is light", () => expect(BRAIN_THEMES.filter((t) => t.light).map((t) => t.id)).toEqual(["inkblot"]));
  it("falls back to Multiverse", () => expect(themeById("nope").id).toBe("multiverse"));
  it("mixes colours", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    const t = themeById("solar-ink");
    expect(mixHex(t.node, t.accent, 0).toLowerCase()).toBe(t.node.toLowerCase());
    expect(mixHex(t.node, t.accent, 1).toLowerCase()).toBe(t.accent.toLowerCase());
  });
});
