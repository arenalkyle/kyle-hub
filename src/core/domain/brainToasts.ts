/** Toast life, merge window and cap (LOCK-81). All times are epoch ms supplied by the caller, so the queue is testable with a fake clock. */
export const TOAST_LIFE_MS = 3000;
export const TOAST_MERGE_MS = 2000;
/** Most toasts shown at full strength; one more, heavily faded, sits above them. */
export const TOAST_MAX = 5;

export interface ToastInput {
  agentId: string;
  name: string;
  color: string;
  kind: "read" | "write";
  /** Vault-relative path. */
  path: string;
}

export interface Toast {
  /** Unique, increasing: a stable key for the DOM. */
  id: number;
  agentId: string;
  name: string;
  color: string;
  reads: number;
  writes: number;
  path: string;
  lastAt: number;
  /** Epoch ms the toast leaves; Infinity while hovered. */
  expiresAt: number;
  /** Whether the pointer is over it (timer paused). */
  hovered: boolean;
  /** Remaining life while hovered. */
  frozen: number;
}

export interface ToastView {
  toast: Toast;
  /** The 6th toast, drawn heavily faded. */
  faded: boolean;
}

/** One toast per agent: activity within the merge window updates it and restarts its timer; the queue keeps the newest 5 + 1 faded. */
export class ToastQueue {
  private list: Toast[] = [];
  private nextId = 1;

  push(i: ToastInput, now: number): void {
    this.tick(now);
    const prev = this.list.find((t) => t.agentId === i.agentId);
    const reads = i.kind === "read" ? 1 : 0, writes = 1 - reads;
    if (prev && now - prev.lastAt <= TOAST_MERGE_MS) {
      const next: Toast = { ...prev, name: i.name, color: i.color, path: i.path, lastAt: now, reads: prev.reads + reads, writes: prev.writes + writes, frozen: TOAST_LIFE_MS };
      next.expiresAt = prev.hovered ? Infinity : now + TOAST_LIFE_MS;
      this.list = this.list.map((t) => (t === prev ? next : t));
      return;
    }
    const fresh: Toast = { id: this.nextId++, agentId: i.agentId, name: i.name, color: i.color, reads, writes, path: i.path, lastAt: now, expiresAt: now + TOAST_LIFE_MS, hovered: false, frozen: TOAST_LIFE_MS };
    this.list = [...this.list.filter((t) => t.agentId !== i.agentId), fresh].slice(-(TOAST_MAX + 1));
  }

  /** Drops expired toasts. Returns true when anything changed. */
  tick(now: number): boolean {
    const n = this.list.length;
    this.list = this.list.filter((t) => t.expiresAt > now);
    return this.list.length !== n;
  }

  /** Pointer entered (pauses the timer) or left (resumes with the remaining life). */
  hover(id: number, on: boolean, now: number): void {
    this.list = this.list.map((t) => {
      if (t.id !== id || t.hovered === on) return t;
      return on ? { ...t, hovered: true, frozen: Math.max(0, t.expiresAt - now), expiresAt: Infinity } : { ...t, hovered: false, expiresAt: now + t.frozen };
    });
  }

  clear(): void {
    this.list = [];
  }

  /** Oldest first (the newest sits at the bottom); the oldest of six is faded. */
  views(): ToastView[] {
    return this.list.map((toast, i) => ({ toast, faded: this.list.length > TOAST_MAX && i === 0 }));
  }
}

/** `Claude read ./a.md`, `Claude wrote ./a.md`, or `Claude read 6 notes · ./last.md` once merged. */
export function toastText(t: Toast, maxPath = 34): string {
  const total = t.reads + t.writes;
  const path = cutPath(t.path, maxPath);
  if (total <= 1) return `${t.name} ${t.writes ? "wrote" : "read"} ${path}`;
  const verb = t.writes === 0 ? "read" : t.reads === 0 ? "wrote" : "touched";
  return `${t.name} ${verb} ${total} notes · ${path}`;
}

/** `./docs/…/readme.md`: keeps the first folder and the file name, cutting the middle. Always starts with `./`. */
export function cutPath(path: string, max = 34): string {
  const full = `./${path.replace(/^\.?\//, "")}`;
  if (full.length <= max) return full;
  const segs = full.slice(2).split("/");
  if (segs.length > 2) {
    const mid = `./${segs[0]}/…/${segs[segs.length - 1]}`;
    if (mid.length <= max) return mid;
  }
  const file = segs[segs.length - 1]!;
  const head = segs.length > 1 ? `./${segs[0]}/…/` : "./";
  const room = Math.max(6, max - head.length);
  if (file.length <= room) return head + file;
  const keep = room - 1, a = Math.ceil(keep / 2), b = Math.floor(keep / 2);
  return `${head}${file.slice(0, a)}…${b ? file.slice(-b) : ""}`;
}
