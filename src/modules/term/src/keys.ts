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
 * macOS uses Cmd (meta) for copy/paste/zoom; Ctrl+C is never copy there.
 * Elsewhere Ctrl is the modifier (Ctrl+C copies only with a selection).
 */
export function decideKey(e: KeyLike, platform: string, hasSelection: boolean): KeyAction {
  const k = e.key.toLowerCase();
  const mac = platform === "darwin";
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
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
