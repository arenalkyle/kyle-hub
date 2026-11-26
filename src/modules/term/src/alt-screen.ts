import type { Terminal } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";

// The bundled ConPTY passes full-screen apps' mode switches through to xterm (term ADR-0003).

const MOUSE_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016]);
/** Tracking modes whose protocol includes the wheel (9 is press-only). */
const WHEEL_MODES = [1000, 1002, 1003] as const;
const SGR_ENCODING = 1006;
/** Pixels of wheel travel per report: a 100 px mouse notch is 5 lines, and trackpad deltas add up proportionally. */
const WHEEL_STEP_PX = 20;
/** Every wheel event counts for at least this much (a full line), so tiny deltas (smooth-scroll wheels, Linux) still move the view. */
const MIN_EVENT_PX = 32;
/** Reports per wheel event, so one huge delta can't flood the app. */
const MAX_REPORTS = 15;
const DOM_DELTA_PIXEL = 0;
const ENTER_ALT = "\x1b[?1049h\x1b[H";

/** An SGR wheel report, as sent by `keepMouseLocal`. */
// eslint-disable-next-line no-control-regex
export const WHEEL_REPORT = /^\x1b\[<6[45];\d+;\d+M$/;

/**
 * Apps that ask for the mouse get it, so clicks reach them (Claude expands a tool call when it is clicked). Shift-drag
 * (Option-drag on macOS) still selects text. The wheel is sent here, proportional reports, to full-screen apps that
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
    travel += Math.sign(e.deltaY) * (e.deltaMode === DOM_DELTA_PIXEL ? Math.max(MIN_EVENT_PX, Math.abs(e.deltaY)) : WHEEL_STEP_PX);
    const count = Math.min(MAX_REPORTS, Math.floor(Math.abs(travel) / WHEEL_STEP_PX));
    if (count === 0) return false;
    // Keep the remainder so the distance scrolled matches the distance asked for.
    travel = Math.abs(travel) >= MAX_REPORTS * WHEEL_STEP_PX ? 0 : travel - Math.sign(travel) * count * WHEEL_STEP_PX;

    const cell = cellAt(term, e.clientX, e.clientY);
    if (!cell) return false;
    // The text moves under a selection, which would then copy something other than what was selected.
    term.clearSelection();
    const report = `\x1b[<${e.deltaY < 0 ? 64 : 65};${cell.col};${cell.row}M`;
    for (let i = 0; i < count; i++) term.input(report, false);
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
