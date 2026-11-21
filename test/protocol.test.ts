import { describe, expect, it } from "vitest";
import { encode, LineDecoder } from "../src/protocol";

describe("protocol", () => {
  it("encodes one JSON object per line", () => {
    expect(encode({ t: "kill", id: "a" })).toBe('{"t":"kill","id":"a"}\n');
  });
  it("handles partial lines", () => {
    const d = new LineDecoder();
    expect(d.push('{"t":"rea')).toEqual([]);
    expect(d.push('dy"}\n')).toEqual([{ t: "ready" }]);
  });
  it("handles several messages in one chunk", () => {
    const d = new LineDecoder();
    expect(d.push('{"t":"ready"}\n{"t":"data","id":"1","data":"x"}\n{"t":"ex')).toEqual([
      { t: "ready" },
      { t: "data", id: "1", data: "x" },
    ]);
    expect(d.push('it"}\n')).toEqual([{ t: "exit" }]);
  });
  it("skips blank and malformed lines", () => {
    expect(new LineDecoder().push('\nnot json\n{"a":1}\n')).toEqual([{ a: 1 }]);
  });
  it("round-trips data with newlines", () => {
    const d = new LineDecoder<{ data: string }>();
    expect(d.push(encode({ t: "data", id: "1", data: "a\r\nb" }))[0]?.data).toBe("a\r\nb");
  });
});
