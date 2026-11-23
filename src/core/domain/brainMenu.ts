/** Brain Vitals popover settings (pure data and normalisers; no UI or Obsidian imports). */

export const ORBIT_MODES = ["drift", "still", "solar", "atom"] as const;
export type OrbitMode = (typeof ORBIT_MODES)[number];
export const DEFAULT_ORBIT_MODE: OrbitMode = "drift";
export const DEFAULT_ORBIT_COLOR = "default";
export const DEFAULT_ORBIT_OPACITY = 0.35;
export const DEFAULT_TOASTS = true;
export const DEFAULT_ORBIT_SPEED = 1;

/** `"default"`, `"rainbow"`, or a lowercase `#rrggbb` string. */
export type OrbitColor = string;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True when `v` is a 3- or 6-digit hex colour, with or without the leading `#`. */
export const isOrbitHex = (v: string): boolean => HEX.test(v.trim());

/** Unknown or malformed values fall back to "default"; hex is returned as lowercase `#rrggbb`. */
export function normalizeOrbitColor(v: unknown): OrbitColor {
  if (v === "default" || v === "rainbow") return v;
  if (typeof v !== "string") return DEFAULT_ORBIT_COLOR;
  const m = HEX.exec(v.trim());
  if (!m) return DEFAULT_ORBIT_COLOR;
  const digits = m[1]!.toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((c) => c + c).join("") : digits}`;
}

export type OrbitColorKind = "default" | "rainbow" | "custom";

export const orbitColorKind = (c: OrbitColor): OrbitColorKind => (c === "default" || c === "rainbow" ? c : "custom");

/** Colour a "custom" choice starts from: the current custom hex, else white. */
export const CUSTOM_ORBIT_COLOR = "#ffffff";

/** The stored colour after picking `kind` in the colour control; `current` is the normalised stored colour. */
export const nextOrbitColor = (kind: OrbitColorKind, current: OrbitColor): OrbitColor => {
  if (kind !== "custom") return kind;
  return orbitColorKind(current) === "custom" ? current : CUSTOM_ORBIT_COLOR;
};

export const isOrbitMode =(v: unknown): v is OrbitMode => ORBIT_MODES.some((m) => m === v);

export const normalizeOrbitMode = (v: unknown): OrbitMode => (isOrbitMode(v) ? v : DEFAULT_ORBIT_MODE);

export function normalizeOrbitOpacity(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_ORBIT_OPACITY;
}

/** Orbit speed multiplier 0..2 (0 freezes orbits); non-numbers fall back to 1. */
export function normalizeOrbitSpeed(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : DEFAULT_ORBIT_SPEED;
}

export const normalizeToasts = (v: unknown): boolean => (typeof v === "boolean" ? v : DEFAULT_TOASTS);

export interface BrainLeafMigration {
  /** Saved brain leaves to repurpose as the Command Center (0 or 1). */
  convert: number;
  /** Saved brain leaves to close. */
  close: number;
}

/**
 * Saved workspace leaves of the removed Brain view: one becomes the Command Center when none is open,
 * the rest (and all of them when a Command Center is already open) are closed.
 */
export function planBrainLeafMigration(brainLeaves: number, commandCenterOpen: boolean): BrainLeafMigration {
  const n = Math.max(0, Math.floor(brainLeaves));
  if (n === 0) return { convert: 0, close: 0 };
  return commandCenterOpen ? { convert: 0, close: n } : { convert: 1, close: n - 1 };
}
