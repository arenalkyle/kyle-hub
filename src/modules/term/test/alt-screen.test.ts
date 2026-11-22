import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";
import { keepMouseLocal, serializeFlat } from "../src/alt-screen";

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
