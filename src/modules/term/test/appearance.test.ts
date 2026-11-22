import { describe, expect, it } from "vitest";
import {
  PRESETS, DEFAULT_APPEARANCE, buildXtermTheme, resolvePalette, withAlpha, parseColor, toHex, mergeAppearance,
  clampFont, blurPx, obsidianPalette, shouldUseWebgl,
} from "../src/appearance";

describe("appearance", () => {
  it("converts terminal opacity into rgba background", () => {
    expect(withAlpha("#282a36", 100)).toBe("rgba(40, 42, 54, 1)");
    expect(withAlpha("#282a36", 50)).toBe("rgba(40, 42, 54, 0.5)");
    expect(withAlpha("rgb(0, 0, 0)", 0)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("#fff", 40)).toBe("rgba(255, 255, 255, 0.4)");
  });
  it("builds an xterm theme from a preset with all 16 ansi colours", () => {
    const pal = resolvePalette({ ...DEFAULT_APPEARANCE, theme: "dracula" }, PRESETS[1]!.palette);
    const t = buildXtermTheme(pal, 80);
    expect(t.background).toBe("rgba(40, 42, 54, 0.8)");
    expect(t.foreground).toBe("#f8f8f2");
    expect(t.red).toBe("#ff5555");
    expect(t.brightWhite).toBe("#ffffff");
    expect(Object.keys(t).length).toBe(5 + 16);
  });
  it("builds from custom and follow-obsidian palettes", () => {
    const custom = { ...DEFAULT_APPEARANCE, theme: "custom" };
    custom.custom = { ...custom.custom, background: "#112233" };
    expect(buildXtermTheme(resolvePalette(custom, PRESETS[0]!.palette), 100).background).toBe("rgba(17, 34, 51, 1)");
    const ob = obsidianPalette((v) => (v === "--background-primary" ? "rgb(10, 20, 30)" : ""));
    expect(ob.background).toBe("rgb(10, 20, 30)");
    expect(ob.ansi).toHaveLength(16);
    expect(resolvePalette({ ...DEFAULT_APPEARANCE, theme: "obsidian" }, ob)).toBe(ob);
  });
  it.each([
    ["dark", "#1c1c1c", "#dadada"],
    ["light", "#ffffff", "#222222"],
  ])("keeps bright white readable on a %s Obsidian theme", (_mode, base00, base100) => {
    const vars: Record<string, string> = { "--background-primary": base00, "--color-base-00": base00, "--color-base-100": base100 };
    expect(obsidianPalette((v) => vars[v] ?? "").ansi[15]).toBe(base100);
  });
  it("has 4 complete presets", () => {
    expect(PRESETS.map((x) => x.id)).toEqual(["dracula", "one-dark", "solarized-dark", "solarized-light"]);
    for (const x of PRESETS) expect(x.palette.ansi).toHaveLength(16);
  });
  it("parses colours and clamps values", () => {
    expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5]);
    expect(parseColor("nope")).toBeNull();
    expect(toHex("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(clampFont(2)).toBe(8);
    expect(clampFont(99)).toBe(32);
    expect(blurPx(100)).toBe(20);
  });
  it("merges saved settings over defaults", () => {
    const m = mergeAppearance({ fontSize: 18, custom: { background: "#000000" } as never });
    expect(m.fontSize).toBe(18);
    expect(m.custom.ansi).toHaveLength(16);
    expect(m.custom.background).toBe("#000000");
  });
  it("uses WebGL only at 100% terminal opacity", () => {
    expect(shouldUseWebgl(100)).toBe(true);
    expect(shouldUseWebgl(99)).toBe(false);
    expect(shouldUseWebgl(0)).toBe(false);
  });
});

describe("resolveFontFamily", () => {
  it("follows Obsidian's monospace font when empty or the old default", async () => {
    const { resolveFontFamily, DEFAULT_FONT_FAMILY } = await import("../src/appearance");
    expect(resolveFontFamily("", "'JetBrains Mono', monospace")).toBe('"JetBrains Mono", monospace');
    expect(resolveFontFamily(DEFAULT_FONT_FAMILY, "Fira Code")).toBe('"Fira Code", monospace');
    expect(resolveFontFamily("  ", "")).toBe(DEFAULT_FONT_FAMILY);
  });
  it("keeps a user font list", async () => {
    const { resolveFontFamily } = await import("../src/appearance");
    expect(resolveFontFamily("Iosevka, monospace", "Fira Code")).toBe('"Iosevka", monospace');
  });
});

describe("sanitizeFontList", () => {
  it("drops Obsidian's ?? placeholders and empty slots, quotes names, ends with monospace", async () => {
    const { sanitizeFontList } = await import("../src/appearance");
    expect(sanitizeFontList(`??, "??", , Menlo, SFMono-Regular, Consolas, "Source Code Pro", monospace`))
      .toBe(`"Menlo", "SFMono-Regular", "Consolas", "Source Code Pro", monospace`);
    expect(sanitizeFontList("JetBrains Mono")).toBe(`"JetBrains Mono", monospace`);
    expect(sanitizeFontList("??")).toContain("Consolas");
  });
});
