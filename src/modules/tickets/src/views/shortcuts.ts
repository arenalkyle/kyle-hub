import { useEffect, type RefObject } from "react";

export type ShortcutAction =
  | "next"
  | "prev"
  | "open"
  | "clear"
  | "new"
  | "status"
  | "priority"
  | "labels"
  | "assignee"
  | "toggleLayout"
  | "filter";

export interface KeyInfo {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** The event target is an input, textarea, select or contenteditable. */
  editable: boolean;
  /** The event target is a button or link (Enter must keep its native meaning). */
  interactive?: boolean;
}

const LETTERS: Record<string, ShortcutAction> = {
  j: "next",
  k: "prev",
  c: "new",
  s: "status",
  p: "priority",
  l: "labels",
  a: "assignee",
  f: "filter",
};

/** Pure key-to-action map. Returns null when the key is not ours or the user is typing. */
export function keyToAction(e: KeyInfo): ShortcutAction | null {
  if (e.editable || e.altKey || e.metaKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.ctrlKey) return e.shiftKey && k === "b" ? "toggleLayout" : null;
  if (k === "ArrowDown") return "next";
  if (k === "ArrowUp") return "prev";
  if (k === "Escape") return "clear";
  if (k === "Enter") return e.interactive ? null : "open";
  return LETTERS[k] ?? null;
}

export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

function isInteractiveTarget(t: EventTarget | null): boolean {
  const tag = (t as HTMLElement | null)?.tagName;
  return tag === "BUTTON" || tag === "A";
}

/** Next/previous id in `ids` (no wrap); with no current selection, `next` picks the first and `prev` the last. */
export function moveSelection(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i === -1) return dir === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))]!;
}

/**
 * Native `keydown` listener on the view root (so keys typed in portaled pickers, which stop
 * propagation, and in other views never reach it). `handler` returns true when it handled the action.
 */
export function useShortcuts(
  rootRef: RefObject<HTMLElement | null>,
  handler: (action: ShortcutAction, e: KeyboardEvent) => boolean,
): void {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const action = keyToAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        editable: isEditableTarget(e.target),
        interactive: isInteractiveTarget(e.target),
      });
      if (action && handler(action, e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [rootRef, handler]);
}
