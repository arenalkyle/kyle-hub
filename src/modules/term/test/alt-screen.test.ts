import { describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";
import { keepMouseLocal, serializeFlat, WHEEL_REPORT } from "../src/alt-screen";

const make = () => new Terminal({ cols: 40, rows: 6, allowProposedApi: true });
const write = (t: Terminal, d: string) => new Promise<void>((resolve) => t.write(d, resolve));

describe("alt screen", () => {
  it("ignores mouse capture but honours the alternate screen", async () => {
    const t = make();
    keepMouseLocal(t);
    await write(t, "\x1b[?1049h\x1b[?1000h\x1b[?1002;1006h\x1b[?1003h\x1b[?2004h");
    expect(t.modes.mouseTrackingMode).toBe("none");
    expect(t.modes.bracketedPasteMode).toBe(true);
    expect(t.buffer.active.type).toBe("alternate");
  });

  it("saves history and screen so that replay stays in the normal buffer with no modes", async () => {
    const t = make();
    const serializer = new SerializeAddon();
    t.loadAddon(serializer);
    await write(t, "history\r\n\x1b[?1049h\x1b[Hscreen\x1b[?1004h\x1b[?2004h");
    const saved = serializeFlat(serializer, 100);
    const copy = make();
    await write(copy, saved);
    expect(copy.buffer.active.type).toBe("normal");
    expect(copy.modes.sendFocusMode).toBe(false);
    expect(copy.modes.bracketedPasteMode).toBe(false);
    expect(saved).toContain("history");
    expect(saved).toContain("screen");
  });
});

describe("wheel", () => {
  const APP = "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1006h";

  /** A terminal showing `output`, with a 400x120 px screen at (100, 50): 10x20 px cells. */
  async function setup(output: string) {
    const t = make();
    const attach = vi.spyOn(t, "attachCustomWheelEventHandler");
    const clear = vi.spyOn(t, "clearSelection").mockImplementation(() => {});
    keepMouseLocal(t);
    const handler = attach.mock.calls[0]![0];
    const screen = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 120 }) };
    Object.defineProperty(t, "element", { value: { querySelector: () => screen } });
    const sent: string[] = [];
    t.onData((d) => sent.push(d));
    await write(t, output);
    const wheel = (deltaY: number, init: Partial<WheelEvent> = {}) =>
      handler({ deltaY, deltaMode: 0, clientX: 125, clientY: 95, ctrlKey: false, shiftKey: false, preventDefault: () => {}, ...init } as WheelEvent);
    return { t, sent, clear, wheel };
  }

  it("sends one report per notch, at the cell under the pointer", async () => {
    const { sent, clear, wheel } = await setup(APP);
    expect(wheel(-100)).toBe(false);
    wheel(72);
    expect(sent).toEqual(["\x1b[<64;3;3M", "\x1b[<65;3;3M"]);
    expect(sent.every((d) => WHEEL_REPORT.test(d))).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("adds up trackpad deltas and starts over when the direction changes", async () => {
    const { sent, wheel } = await setup(APP);
    for (const d of [15, 15, -15, -15]) wheel(d);
    expect(sent).toEqual([]);
    wheel(-15);
    expect(sent).toEqual(["\x1b[<64;3;3M"]);
  });

  it("treats a line delta as a notch", async () => {
    const { sent, wheel } = await setup(APP);
    wheel(3, { deltaMode: 1 });
    expect(sent).toEqual(["\x1b[<65;3;3M"]);
  });

  it("clamps to the grid", async () => {
    const { sent, wheel } = await setup(APP);
    wheel(100, { clientX: 9999, clientY: 0 });
    expect(sent).toEqual(["\x1b[<65;40;1M"]);
  });

  it("leaves the normal buffer to xterm's own scrolling", async () => {
    const { sent, wheel } = await setup("\x1b[?1000h\x1b[?1006h");
    expect(wheel(100)).toBe(true);
    expect(sent).toEqual([]);
  });

  it.each([
    ["never asked for the mouse", "\x1b[?1049h"],
    ["didn't ask for SGR reports", "\x1b[?1049h\x1b[?1000h"],
    ["turned the mouse off", `${APP}\x1b[?1000;1002l`],
    ["came after an app that left the screen", `${APP}\x1b[?1049l\x1b[?1049h`],
  ])("sends nothing, not even arrows, to an app that %s", async (_name, output) => {
    const { sent, wheel } = await setup(output);
    expect(wheel(100)).toBe(false);
    expect(sent).toEqual([]);
  });

  it("forgets the request on reset", async () => {
    const { t, sent, wheel } = await setup(APP);
    t.reset();
    await write(t, "\x1b[?1049h");
    wheel(100);
    expect(sent).toEqual([]);
  });

  it.each(["ctrlKey", "shiftKey"] as const)("ignores the wheel with %s", async (key) => {
    const { sent, wheel } = await setup(APP);
    expect(wheel(100, { [key]: true })).toBe(false);
    expect(sent).toEqual([]);
  });
});
