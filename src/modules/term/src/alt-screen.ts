import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";

// The bundled ConPTY passes full-screen apps' mode switches through to xterm (term ADR-0003).

const MOUSE_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016]);
/** Tracking modes whose protocol includes the wheel (9 is press-only). */
const WHEEL_MODES = [1000, 1002, 1003] as const;
const SGR_ENCODING = 1006;
/** Below a mouse notch (100 px, less when zoomed), so each notch is one report and trackpad deltas add up to one. */
const WHEEL_STEP_PX = 40;
const DOM_DELTA_PIXEL = 0;
const ENTER_ALT = "\x1b[?1049h\x1b[H";

/** An SGR wheel report, as sent by `keepMouseLocal`. */
// eslint-disable-next-line no-control-regex
export const WHEEL_REPORT = /^\x1b\[<6[45];\d+;\d+M$/;

/**
 * Apps that ask for the mouse get it, so clicks reach them (Claude expands a tool call when it is clicked). Shift-drag
 * (Option-drag on macOS) still selects text. The wheel is sent here, one report per notch, to full-screen apps that
 * asked for the mouse; in other full-screen apps it does nothing: xterm's default there is Up/Down, which would cycle
 * prompt history.
 */
export function keepMouseLocal(term: Terminal): void {
  const requested = new Set<number>();
  let travel = 0;

  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    for (const p of params) if (typeof p === "number" && MOUSE_MODES.has(p)) requested.add(p);
    return false;
  });
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    for (const p of params) if (typeof p === "number") requested.delete(p);
    return false;
  });
  // Leaving the alternate screen and term.reset() both land here: an app that was killed can't turn its modes off.
  term.buffer.onBufferChange((buffer) => {
    travel = 0;
    if (buffer.type === "normal") requested.clear();
  });

  term.attachCustomWheelEventHandler((e) => {
    if (term.buffer.active.type !== "alternate") return true;
    if (e.deltaY === 0 || e.ctrlKey || e.shiftKey) return false;
    if (!requested.has(SGR_ENCODING) || !WHEEL_MODES.some((mode) => requested.has(mode))) return false;
    e.preventDefault();

    if (Math.sign(e.deltaY) !== Math.sign(travel)) travel = 0;
    // Line and page deltas are always whole notches.
    travel += e.deltaMode === DOM_DELTA_PIXEL ? e.deltaY : Math.sign(e.deltaY) * WHEEL_STEP_PX;
    if (Math.abs(travel) < WHEEL_STEP_PX) return false;
    travel = 0;

    const cell = cellAt(term, e.clientX, e.clientY);
    if (!cell) return false;
    // The text moves under a selection, which would then copy something other than what was selected.
    term.clearSelection();
    term.input(`\x1b[<${e.deltaY < 0 ? 64 : 65};${cell.col};${cell.row}M`, false);
    return false;
  });
}

/** The 1-based cell under a viewport point, clamped to the grid. */
function cellAt(term: Terminal, x: number, y: number): { col: number; row: number } | undefined {
  const rect = term.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return undefined;
  const at = (offset: number, size: number, count: number): number =>
    Math.min(count, Math.max(1, Math.floor((offset / size) * count) + 1));
  return { col: at(x - rect.left, rect.width, term.cols), row: at(y - rect.top, rect.height, term.rows) };
}

/** History plus the current screen as plain scrollback: replaying it must not switch buffers or turn modes on. */
export function serializeFlat(serializer: SerializeAddon, lines: number): string {
  return serializer.serialize({ scrollback: lines, excludeModes: true }).replace(ENTER_ALT, "\r\n");
}
