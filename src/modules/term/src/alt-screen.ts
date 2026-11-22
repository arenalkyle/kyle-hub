import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";

// The bundled ConPTY passes full-screen apps' mode switches through to xterm (term ADR-0003).

const MOUSE_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016]);
const ENTER_ALT = "\x1b[?1049h\x1b[H";

/**
 * The mouse stays with the terminal (drag to select, right-click to paste), so apps can't capture it.
 * Without capture, xterm would turn the wheel into Up/Down in the alternate screen and cycle Claude's prompt history.
 */
export function keepMouseLocal(term: Terminal): void {
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => params.every((p) => typeof p === "number" && MOUSE_MODES.has(p)));
  term.attachCustomWheelEventHandler(() => term.buffer.active.type !== "alternate");
}

/** History plus the current screen as plain scrollback: replaying it must not switch buffers or turn modes on. */
export function serializeFlat(serializer: SerializeAddon, lines: number): string {
  return serializer.serialize({ scrollback: lines, excludeModes: true }).replace(ENTER_ALT, "\r\n");
}
