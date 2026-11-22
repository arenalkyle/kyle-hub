import { describe, expect, it } from "vitest";
import { parseColor } from "../src/appearance";
import { COLORS, colorDistance, nextColor } from "../src/colors";

const take = (n: number): string[] => {
  const used: string[] = [];
  for (let i = 0; i < n; i++) used.push(nextColor(used));
  return used;
};

const hueOf = (color: string): number => {
  const [r, g, b] = parseColor(color)!;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe("nextColor", () => {
  it("never repeats a colour in use, however many sessions there are", () => {
    expect(new Set(take(300)).size).toBe(300);
  });

  it("never hands out the blue and green that mean needs-input and finished", () => {
    const auto = take(300);
    expect(auto).not.toContain(COLORS.Blue);
    expect(auto).not.toContain(COLORS.Green);
    for (const c of auto) {
      expect(Math.abs(hueOf(c) - 128)).toBeGreaterThan(15);
      expect(Math.abs(hueOf(c) - 218)).toBeGreaterThan(15);
    }
  });

  it("keeps colours visibly different, also past the palette", () => {
    const all = [...take(20), COLORS.Blue, COLORS.Green];
    const close: string[] = [];
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => { if (colorDistance(a, b) < 0.06) close.push(`${a} ~ ${b}`); }));
    expect(close).toEqual([]);
  });

  it("reuses the first colour that is free again", () => {
    const [a, b, c] = take(3);
    expect(nextColor([a, c])).toBe(b);
  });

  it("works around untagged sessions and hand-picked colours", () => {
    const [a, b] = take(2);
    expect(nextColor([undefined, a])).toBe(b);
  });
});
