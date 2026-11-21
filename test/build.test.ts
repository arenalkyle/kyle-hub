import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const main = path.join(root, "main.js");

describe("build output (needs `npm run build` first; skipped otherwise)", () => {
  it.skipIf(!fs.existsSync(main))("node-pty is not bundled into main.js (term ADR-0001)", () => {
    expect(fs.readFileSync(main, "utf8")).not.toMatch(/node-pty/);
  });

  it("the helper process is spawned from the plugin dir, not bundled", () => {
    const host = fs.readFileSync(path.join(root, "src/modules/term/src/main.ts"), "utf8");
    expect(host).toMatch(/path\.join\(this\.pluginDir\(\), "helper", "pty-host\.js"\)/);
    expect(host).toMatch(/"plugins", PLUGIN_ID/);
    const src = fs.readdirSync(path.join(root, "src/modules/term/src")).map((f) => fs.readFileSync(path.join(root, "src/modules/term/src", f), "utf8"));
    expect(src.join("\n")).not.toMatch(/from "@lydell\/node-pty"|require\("@lydell\/node-pty"\)/);
    expect(fs.readFileSync(path.join(root, "src/modules/term/helper/pty-host.js"), "utf8")).toMatch(/node-pty/);
  });
});
