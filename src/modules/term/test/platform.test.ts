import { describe, expect, it } from "vitest";
import { fallbackDirs, mergePath, parseMarkedPath, resolvePath, type PathDeps } from "../src/path-env";
import { decideKey, type KeyLike } from "../src/keys";
import { detectProfiles, pickProfileId, type DetectDeps } from "../src/shells";
import { hookCommand, installHooks } from "../src/hook-installer";
import { buildRef } from "../src/vault-paths";
// @ts-expect-error plain JS module
import { parseVaults } from "../../../../scripts/deploy.mjs";

describe("PATH merge", () => {
  it("dedupes, keeps order, uses platform separator", () => {
    expect(mergePath(["/a:/b", "/b:/c", undefined, ""], "darwin")).toBe("/a:/b:/c");
    expect(mergePath(["C:\\a;C:\\b", "C:\\b"], "win32")).toBe("C:\\a;C:\\b");
  });
  it("extracts marked PATH past banners", () => {
    expect(parseMarkedPath("hello\n__KT__/x:/y__KT__\n")).toBe("/x:/y");
    expect(parseMarkedPath("no markers")).toBeNull();
    expect(parseMarkedPath("__KT____KT__")).toBeNull();
  });
  const deps = (o: Partial<PathDeps>): PathDeps => ({
    platform: "darwin", env: { PATH: "/usr/bin", SHELL: "/bin/zsh" }, home: "/Users/k",
    exists: (p) => p === "/opt/homebrew/bin" || p === "/Users/k/.local/bin",
    probe: async () => "/opt/homebrew/bin:/usr/bin", ...o,
  });
  it("mac: probe + current + existing fallbacks", async () => {
    expect(await resolvePath(deps({}))).toBe("/opt/homebrew/bin:/usr/bin:/Users/k/.local/bin");
  });
  it("mac: probe failure still adds fallbacks", async () => {
    expect(await resolvePath(deps({ probe: async () => null }))).toBe("/usr/bin:/opt/homebrew/bin:/Users/k/.local/bin");
  });
  it("mac: uses $SHELL, else /bin/bash", async () => {
    const seen: string[] = [];
    await resolvePath(deps({ probe: async (s) => { seen.push(s); return null; } }));
    await resolvePath(deps({ env: { PATH: "" }, probe: async (s) => { seen.push(s); return null; } }));
    expect(seen).toEqual(["/bin/zsh", "/bin/bash"]);
  });
  it("windows: PATH untouched", async () => {
    let probed = false;
    const r = await resolvePath(deps({ platform: "win32", env: { PATH: "C:\\x" }, probe: async () => { probed = true; return "z"; } }));
    expect(r).toBe("C:\\x");
    expect(probed).toBe(false);
  });
  it("fallback dirs list", () => { expect(fallbackDirs("/h")).toContain("/h/.npm-global/bin"); });
});

describe("profiles per platform", () => {
  const d = (o: Partial<DetectDeps>): DetectDeps => ({ platform: "darwin", env: {}, exists: () => false, where: () => null, ...o });
  it("mac: bash first then zsh", () => {
    const p = detectProfiles(d({ exists: (x) => x === "/bin/bash" || x === "/bin/zsh" }));
    expect(p.map((x) => [x.id, x.args])).toEqual([["bash", ["-l"]], ["zsh", ["-l"]]]);
  });
  it("mac: no Windows profiles; fallback when nothing found", () => {
    expect(detectProfiles(d({})).map((x) => x.id)).toEqual(["bash"]);
  });
  it("saved profile from the other platform falls back to default", () => {
    const mac = detectProfiles(d({ exists: () => true }));
    expect(pickProfileId("powershell", mac)).toBe("bash");
    expect(pickProfileId("zsh", mac)).toBe("zsh");
    const win = detectProfiles({ platform: "win32", env: {}, exists: () => false, where: () => null });
    expect(pickProfileId("bash", win)).toBe("powershell");
  });
});

describe("key decisions", () => {
  const k = (key: string, m: Partial<KeyLike> = {}): KeyLike => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });
  it("mac: Cmd copy/paste/zoom", () => {
    expect(decideKey(k("c", { metaKey: true }), "darwin", true)).toBe("copy");
    expect(decideKey(k("c", { metaKey: true }), "darwin", false)).toBeNull();
    expect(decideKey(k("v", { metaKey: true }), "darwin", false)).toBe("paste");
    expect(decideKey(k("=", { metaKey: true }), "darwin", false)).toBe("zoom-in");
    expect(decideKey(k("-", { metaKey: true }), "darwin", false)).toBe("zoom-out");
    expect(decideKey(k("0", { metaKey: true }), "darwin", false)).toBe("zoom-reset");
  });
  it("mac: Ctrl+C always interrupts (never copy)", () => {
    expect(decideKey(k("c", { ctrlKey: true }), "darwin", true)).toBeNull();
    expect(decideKey(k("v", { ctrlKey: true }), "darwin", true)).toBeNull();
  });
  it("windows: Ctrl copy only with selection; Cmd ignored", () => {
    expect(decideKey(k("c", { ctrlKey: true }), "win32", true)).toBe("copy");
    expect(decideKey(k("c", { ctrlKey: true }), "win32", false)).toBeNull();
    expect(decideKey(k("v", { ctrlKey: true }), "win32", false)).toBe("paste");
    expect(decideKey(k("c", { metaKey: true }), "win32", true)).toBeNull();
    expect(decideKey(k("=", { ctrlKey: true }), "win32", false)).toBe("zoom-in");
  });
  it("Shift+Enter newline on both", () => {
    expect(decideKey(k("Enter", { shiftKey: true }), "darwin", false)).toBe("newline");
    expect(decideKey(k("Enter", { shiftKey: true }), "win32", false)).toBe("newline");
  });
});

describe("hook commands", () => {
  it("windows keeps double quotes", () => {
    expect(hookCommand("C:\\a b\\kyle-hook.js", "Stop", "win32")).toBe('node "C:\\a b\\kyle-hook.js" Stop');
  });
  it("posix single-quotes paths with spaces and quotes", () => {
    expect(hookCommand("/Users/k/My Vault/kyle-hook.js", "Stop", "darwin")).toBe("node '/Users/k/My Vault/kyle-hook.js' Stop");
    expect(hookCommand("/Users/k/it's/kyle-hook.js", "Stop", "darwin")).toBe("node '/Users/k/it'\\''s/kyle-hook.js' Stop");
  });
  it("installHooks takes the platform", () => {
    const s = installHooks({}, "/a b/kyle-hook.js", "darwin") as any;
    expect(s.hooks.Stop[0].hooks[0].command).toBe("node '/a b/kyle-hook.js' Stop");
  });
});

describe("POSIX paths and vault lists", () => {
  it("buildRef posix relative/absolute/spaces", () => {
    expect(buildRef("/Users/k/V/notes/a.md", "/Users/k/V", "relative", "posix")).toBe("@notes/a.md");
    expect(buildRef("/Users/k/V/My Notes/a.md", "/Users/k/V", "relative", "posix")).toBe('@"My Notes/a.md"');
    expect(buildRef("/Users/k/Other/a.md", "/Users/k/V", "relative", "posix")).toBe("@/Users/k/Other/a.md");
    expect(buildRef("/Users/k/V/a.md", "/Users/k/V", "absolute", "posix")).toBe("@/Users/k/V/a.md");
  });
  it("parseVaults splits ';' everywhere, ':' only off Windows", () => {
    expect(parseVaults("/a/v1:/b/v2;/c/v3", "darwin")).toEqual(["/a/v1", "/b/v2", "/c/v3"]);
    expect(parseVaults("C:\\v1;D:\\v2", "win32")).toEqual(["C:\\v1", "D:\\v2"]);
  });
});
