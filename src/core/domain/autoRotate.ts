/** Auto-rotation pause/resume logic, independent of WebGL: rotation stops on any input and resumes `resumeMs` after the last one. */
export const RESUME_MS = 5000;
export const DEFAULT_ROTATE_SPEED = 0.3;

export class RotationGate {
  private held = false;
  private flying = false;
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly resumeMs = RESUME_MS) {}

  /** A drag (or similar held input) began. */
  hold(now: number): void {
    this.held = true;
    this.last = now;
  }

  /** The held input ended; the resume countdown starts here. */
  release(now: number): void {
    this.held = false;
    this.last = now;
  }

  /** A momentary input (wheel zoom, click). */
  input(now: number): void {
    this.last = now;
  }

  /** The camera is flying to a target; the countdown restarts when the flight ends. */
  setFlying(flying: boolean, now: number): void {
    if (flying !== this.flying) this.last = now;
    this.flying = flying;
  }

  active(now: number): boolean {
    return !this.held && !this.flying && now - this.last >= this.resumeMs;
  }
}

export function rotateSpeedOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_ROTATE_SPEED;
}
