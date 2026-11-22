import { parseColor, toHex } from "./appearance";

/** Session colour tags, as offered in the context menu. */
export const COLORS = {
  Orange: "#e08a2c",
  Purple: "#a371f7",
  Cyan: "#22c3d6",
  Pink: "#ec5fa8",
  Yellow: "#d4b106",
  Red: "#e5534b",
  Lime: "#a5d32a",
  Brown: "#9c6b4e",
  Blue: "#4c8dff",
  Green: "#3fb950",
} as const;

/** In hand-out order, so neighbours differ. No blue or green: on a pane those mean needs-input and finished. */
const AUTO: readonly string[] = [
  COLORS.Orange, COLORS.Purple, COLORS.Cyan, COLORS.Pink, COLORS.Yellow, COLORS.Red, COLORS.Lime, COLORS.Brown,
];
const STATE_HUES = [128, 218];
const STATE_HUE_MARGIN = 22;

type Lab = readonly [number, number, number];

/** Oklab, where straight-line distance is close to how different two colours look. */
function oklab(color: string): Lab | undefined {
  const rgb = parseColor(color);
  if (!rgb) return undefined;
  const linear = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const r = linear(rgb[0]), g = linear(rgb[1]), b = linear(rgb[2]);
  const l = Math.cbrt(0.4122 * r + 0.5363 * g + 0.0514 * b);
  const m = Math.cbrt(0.2119 * r + 0.6807 * g + 0.1074 * b);
  const s = Math.cbrt(0.0883 * r + 0.2817 * g + 0.63 * b);
  return [0.21 * l + 0.7936 * m - 0.0041 * s, 1.978 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
}

/** How different two colours look: 0 is identical, about 0.02 is barely noticeable. */
export function colorDistance(a: string, b: string): number {
  const x = oklab(a), y = oklab(b);
  return x && y ? between(x, y) : Infinity;
}

const between = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function hslHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): number => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return toHex(`rgb(${channel(0)}, ${channel(8)}, ${channel(4)})`);
}

/** Colours to generate from: visible on light and dark backgrounds, clear of the two state hues. */
function candidates(): Array<{ color: string; lab: Lab }> {
  const out: Array<{ color: string; lab: Lab }> = [];
  for (let hue = 0; hue < 360; hue += 6) {
    if (STATE_HUES.some((h) => Math.abs(hue - h) < STATE_HUE_MARGIN)) continue;
    for (const saturation of [0.3, 0.6, 0.9]) {
      for (const lightness of [0.36, 0.46, 0.56, 0.66, 0.76]) {
        const color = hslHex(hue, saturation, lightness);
        out.push({ color, lab: oklab(color)! });
      }
    }
  }
  return out;
}
let pool: ReturnType<typeof candidates> | undefined;

/** The first palette colour no session is using; past the palette, whatever looks least like the colours in use. */
export function nextColor(inUse: Iterable<string | undefined>): string {
  const used = new Set<string>();
  for (const c of inUse) if (c) used.add(c);
  const free = AUTO.find((c) => !used.has(c));
  if (free) return free;

  const labs = [...used, COLORS.Blue, COLORS.Green].map(oklab).filter((l): l is Lab => l !== undefined);
  pool ??= candidates();
  let best = pool[0]!.color;
  let bestGap = -1;
  for (const { color, lab } of pool) {
    const gap = Math.min(...labs.map((l) => between(l, lab)));
    if (gap > bestGap) { best = color; bestGap = gap; }
  }
  return best;
}
