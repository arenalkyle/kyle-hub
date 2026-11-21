export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type KeyAction = "copy" | "paste" | "zoom-in" | "zoom-out" | "zoom-reset" | "newline" | null;

/**
 * Decide a terminal shortcut. `hasSelection` gates copy so Ctrl+C still interrupts.
 * Ctrl is the modifier (Ctrl+C copies only with a selection).
 */
export function decideKey(e: KeyLike, hasSelection: boolean): KeyAction {
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey && !e.metaKey;
  if (mod && !e.altKey) {
    if (!e.shiftKey && k === "c" && hasSelection) return "copy";
    if (k === "v") return "paste";
    if (k === "=" || k === "+") return "zoom-in";
    if (k === "-") return "zoom-out";
    if (k === "0") return "zoom-reset";
  }
  if (k === "enter" && e.shiftKey && !e.ctrlKey && !e.altKey) return "newline";
  return null;
}
