/** Pure appearance logic: palettes, presets, colour maths, xterm theme building. */

export const ANSI_KEYS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;
export type AnsiKey = (typeof ANSI_KEYS)[number];

export interface Palette {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  ansi: string[]; // 16 entries, order of ANSI_KEYS
}

export interface Preset {
  id: string;
  name: string;
  palette: Palette;
}

const p = (background: string, foreground: string, cursor: string, selection: string, ansi: string[]): Palette => ({
  background, foreground, cursor, selection, ansi,
});

/** Add a preset by appending one object here. */
export const PRESETS: Preset[] = [
  {
    id: "dracula", name: "Dracula",
    palette: p("#282a36", "#f8f8f2", "#f8f8f2", "#44475a", [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ]),
  },
  {
    id: "one-dark", name: "One Dark",
    palette: p("#282c34", "#abb2bf", "#528bff", "#3e4451", [
      "#282c34", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
      "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
    ]),
  },
  {
    id: "solarized-dark", name: "Solarized Dark",
    palette: p("#002b36", "#839496", "#93a1a1", "#073642", [
      "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
    ]),
  },
  {
    id: "solarized-light", name: "Solarized Light",
    palette: p("#fdf6e3", "#657b83", "#586e75", "#eee8d5", [
      "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
    ]),
  },
];

export const THEME_FOLLOW = "obsidian";
export const THEME_CUSTOM = "custom";

export interface AppearanceSettings {
  /** "obsidian" | "custom" | preset id */
  theme: string;
  custom: Palette;
  fontFamily: string;
  fontSize: number;
  /** "" = none; "vault:<path>" for a vault file; otherwise an absolute file path. */
  bgImage: string;
  imageOpacity: number; // 0-100
  imageBlur: number; // 0-100 slider, mapped to 0-20 px
  imageDim: number; // 0-100
  terminalOpacity: number; // 0-100
}

export const DEFAULT_FONT_FAMILY = "Consolas, 'Cascadia Mono', Menlo, 'DejaVu Sans Mono', monospace";
export const MIN_FONT = 8;
export const MAX_FONT = 32;

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: THEME_FOLLOW,
  custom: structuredClone(PRESETS[0]!.palette),
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 14,
  bgImage: "",
  imageOpacity: 60,
  imageBlur: 0,
  imageDim: 30,
  terminalOpacity: 100,
};

export function mergeAppearance(saved: Partial<AppearanceSettings> | undefined): AppearanceSettings {
  const d = DEFAULT_APPEARANCE;
  const custom = { ...structuredClone(d.custom), ...saved?.custom };
  if (!Array.isArray(custom.ansi) || custom.ansi.length !== 16) custom.ansi = [...d.custom.ansi];
  return { ...d, ...saved, custom };
}

export function clampFont(n: number): number {
  return Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(n)));
}

export function blurPx(slider: number): number {
  return (Math.max(0, Math.min(100, slider)) / 100) * 20;
}

/** Parse "#rgb", "#rrggbb", "#rrggbbaa", "rgb()/rgba()" into [r,g,b,a]. */
export function parseColor(s: string): [number, number, number, number] | null {
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) {
    const h = m[1]!;
    return [0, 1, 2].map((i) => parseInt(h[i]! + h[i]!, 16)).concat(1) as [number, number, number, number];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(t);
  if (m) {
    const h = m[1]!;
    const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  return null;
}

/** Colour with alpha = opacity% (multiplied by any alpha already in the colour). */
export function withAlpha(color: string, opacityPct: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const a = (Math.max(0, Math.min(100, opacityPct)) / 100) * c[3];
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(a * 1000) / 1000})`;
}

/** "#rrggbb" for an <input type=color>; falls back to black. */
export function toHex(color: string): string {
  const c = parseColor(color);
  if (!c) return "#000000";
  return "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

export function resolvePalette(a: AppearanceSettings, obsidian: Palette): Palette {
  if (a.theme === THEME_FOLLOW) return obsidian;
  if (a.theme === THEME_CUSTOM) return a.custom;
  return (PRESETS.find((x) => x.id === a.theme) ?? PRESETS[0]!).palette;
}

export type XtermTheme = Record<string, string>;

export function buildXtermTheme(palette: Palette, terminalOpacity: number): XtermTheme {
  const t: XtermTheme = {
    background: withAlpha(palette.background, terminalOpacity),
    foreground: palette.foreground,
    cursor: palette.cursor,
    cursorAccent: palette.background,
    selectionBackground: palette.selection,
  };
  ANSI_KEYS.forEach((k, i) => { t[k] = palette.ansi[i] ?? "#000000"; });
  return t;
}

/** Obsidian CSS variable per ANSI slot (normal colours), with fallbacks. */
export const OBSIDIAN_ANSI_VARS: Array<[string, string]> = [
  ["--color-base-00", "#000000"], ["--color-red", "#e93147"], ["--color-green", "#08b94e"], ["--color-yellow", "#e0ac00"],
  ["--color-blue", "#086ddd"], ["--color-purple", "#7852ee"], ["--color-cyan", "#00bfbc"], ["--color-base-70", "#bbbbbb"],
];

/** Build the "Follow Obsidian" palette. `read(var)` returns a resolved colour string or "". */
export function obsidianPalette(read: (cssVar: string) => string): Palette {
  const g = (v: string, fb: string) => (read(v) && parseColor(read(v)) ? read(v) : fb);
  const normal = OBSIDIAN_ANSI_VARS.map(([v, fb]) => g(v, fb));
  const ansi = [...normal, ...normal];
  ansi[8] = g("--color-base-50", "#666666");
  ansi[15] = g("--color-base-00", "#ffffff");
  return {
    background: g("--background-primary", "#1e1e1e"),
    foreground: g("--text-normal", "#dcddde"),
    cursor: g("--text-accent", "#7f6df2"),
    selection: g("--text-selection", "rgba(100,100,255,0.35)"),
    ansi,
  };
}

/** WebGL only when the terminal background is fully opaque; otherwise use the DOM renderer. */
export function shouldUseWebgl(terminalOpacity: number): boolean {
  return terminalOpacity >= 100;
}
