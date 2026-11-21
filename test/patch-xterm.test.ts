import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
// @ts-expect-error untyped build script
import { patchWebglAtlasFont } from "../scripts/patch-xterm.mjs";

/** Evaluate the patched template literal with the given style/weight. */
const fontOf = (style: string, weight: string, src: string): string => {
  const tpl = /\.font=(`[^`]*`)/.exec(src)![1];
  const cfg = { _config: { fontSize: 17, fontFamily: "monospace" } };
  return new Function("ue", "G", `return ${tpl};`).call(cfg, style, weight) as string;
};

describe("patchWebglAtlasFont", () => {
  it("removes the leading space Chromium rejects in canvas ctx.font", () => {
    const out = patchWebglAtlasFont("x.font=`${ue} ${G} ${this._config.fontSize}px ${this._config.fontFamily}`") as string;
    expect(out).toBe('x.font=`${[ue,G].filter(Boolean).join(" ")} ${this._config.fontSize}px ${this._config.fontFamily}`');
    expect(fontOf("", "normal", out)).toBe("normal 17px monospace");
    expect(fontOf("italic", "bold", out)).toBe("italic bold 17px monospace");
  });

  it("applies to the installed @xterm/addon-webgl build", () => {
    const req = createRequire(import.meta.url);
    const file = req.resolve("@xterm/addon-webgl").replace(/addon-webgl\.js$/, "addon-webgl.mjs");
    const out = patchWebglAtlasFont(readFileSync(file, "utf8")) as string;
    expect(out).not.toMatch(/\.font=`\$\{\w+\} \$\{\w+\} /);
  });

  it("fails loudly when the template is gone", () => {
    expect(() => patchWebglAtlasFont("nothing here")).toThrow(/not found/);
  });
});
