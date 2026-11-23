/** Brain colour themes (pure data). The ten palettes are adapted from Hivemynd (see NOTICE); they style the 3D brain only. */
export interface BrainTheme {
  id: string;
  name: string;
  mood: string;
  /** Light themes draw ink on paper: normal blending, no bloom. */
  light: boolean;
  bg: string;
  node: string;
  link: string;
  accent: string;
}

export const DEFAULT_THEME = "multiverse";

export const BRAIN_THEMES: readonly BrainTheme[] = [
  { id: "multiverse", name: "Multiverse", mood: "Glowing glass on black. Up close, every note is a turning galaxy.", light: false, bg: "#070b16", node: "#3ee8de", link: "#2fd3c9", accent: "#ffc94d" },
  { id: "inkblot", name: "Inkblot", mood: "Ink on paper. Notes drift like small oil blobs.", light: true, bg: "#f1ede2", node: "#1d2230", link: "#4a4f66", accent: "#c2410c" },
  { id: "violet-dusk", name: "Violet Dusk", mood: "Calm and a little mystical, like thoughts lighting up in a dim room.", light: false, bg: "#1E2230", node: "#B89CFF", link: "#4A4F6A", accent: "#8B5CF6" },
  { id: "aurora-moss", name: "Aurora Moss", mood: "Organic and alive, like bioluminescence in a forest at night.", light: false, bg: "#0D1A14", node: "#C6F16D", link: "#2F4A3A", accent: "#FF6FB5" },
  { id: "copper-ember", name: "Copper Ember", mood: "Grounded, earthy and handcrafted.", light: false, bg: "#3A3633", node: "#D9CFC4", link: "#6B625B", accent: "#C87533" },
  { id: "lifeblood", name: "Lifeblood", mood: "Arteries and veins, pumping from note to note.", light: false, bg: "#140306", node: "#E5484D", link: "#C0141F", accent: "#FF5A4E" },
  { id: "matrix", name: "Matrix", mood: "Green code rain, notes as glowing glyphs.", light: false, bg: "#010703", node: "#00FF41", link: "#0B8F3A", accent: "#B6FFC8" },
  { id: "mycelium", name: "Mycelium", mood: "A forest floor at night: fungal threads beaded with dew drops.", light: false, bg: "#0E0B08", node: "#E8D9B5", link: "#D8C7A0", accent: "#7CFFB2" },
  { id: "solar-ink", name: "Solar Ink", mood: "Bold and energetic, like a sunrise breaking through ink.", light: false, bg: "#14112B", node: "#FF7A59", link: "#4B3B6B", accent: "#FFD23F" },
  { id: "tide-pulse", name: "Tide Pulse", mood: "Clean, technical and quietly alive, like a heartbeat moving through the network.", light: false, bg: "#1C1F21", node: "#5EEAD4", link: "#3A4144", accent: "#14B8A6" },
];

export function themeById(id: unknown): BrainTheme {
  return BRAIN_THEMES.find((t) => t.id === id) ?? BRAIN_THEMES[0]!;
}

export const isThemeId = (id: unknown): id is string => BRAIN_THEMES.some((t) => t.id === id);

const toRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** Linear mix of two `#rrggbb` colours in sRGB (t = 0 gives `a`, 1 gives `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const x = toRgb(a), y = toRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Three soft nebula tints derived from the palette: node, accent and link colours washed into the background. */
export function nebulaColors(t: BrainTheme): [string, string, string] {
  return [mixHex(t.bg, t.node, 0.55), mixHex(t.bg, t.accent, 0.55), mixHex(t.bg, t.link, 0.7)];
}
