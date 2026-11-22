/** Animation frame rates offered in settings (shared by the Command Center and the 3D brain, LOCK-67). */
export const FPS_CHOICES = [10, 20, 30, 60] as const;
export type FpsChoice = (typeof FPS_CHOICES)[number];
export const DEFAULT_FPS: FpsChoice = 30;

/** Any stored value to a valid frame rate; unknown values fall back to the default. */
export function normalizeFps(v: unknown): FpsChoice {
  return FPS_CHOICES.find((c) => c === v) ?? DEFAULT_FPS;
}
