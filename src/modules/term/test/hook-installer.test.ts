import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyToFile, HOOK_EVENTS, hookCommand, installHooks, loadSettingsFile, planHookInstall, planHookUninstall, uninstallHooks } from "../src/hook-installer";

const script = "C:\\Vault\\.obsidian\\plugins\\kyle-hub\\hooks\\kyle-hook.js";
const oldScript = "C:\\Vault\\.obsidian\\plugins\\kyle-term\\hooks\\kyle-hook.js";
const other = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] }, model: "x", env: { A: "1" } };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const count = (s: Record<string, unknown>): number => JSON.stringify(s).split("kyle-hook.js").length - 1;

describe("installHooks / uninstallHooks", () => {
  it("empty settings get every event", () => {
    const r = installHooks({}, script) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; timeout: number }> }>> };
    expect(Object.keys(r.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(r.hooks.PreToolUse![0]!.matcher).toBe("*");
    expect(r.hooks.Stop![0]!.matcher).toBeUndefined();
    expect(r.hooks.Stop![0]!.hooks[0]).toEqual({ type: "command", command: `node "${script}" Stop`, timeout: 5 });
  });
  it("keeps other settings and hooks untouched", () => {
    const r = installHooks(clone(other), script) as typeof other & { hooks: Record<string, unknown[]> };
    expect(r.model).toBe("x");
    expect(r.env).toEqual({ A: "1" });
    expect(r.hooks.Stop![0]).toEqual(other.hooks.Stop[0]);
    expect(r.hooks.PreToolUse![0]).toEqual(other.hooks.PreToolUse[0]);
    expect(r.hooks.Stop).toHaveLength(2);
  });
  it("is idempotent and replaces entries from another vault", () => {
    const once = installHooks(clone(other), script);
    expect(installHooks(clone(once), script)).toEqual(once);
    const moved = installHooks(clone(once), "D:\\v2\\.obsidian\\plugins\\kyle-hub\\hooks\\kyle-hook.js");
    expect(count(moved)).toBe(HOOK_EVENTS.length);
    expect(JSON.stringify(moved)).not.toContain("C:\\\\Vault");
  });
  it("uninstall round-trips back to the original", () => {
    expect(uninstallHooks(installHooks(clone(other), script))).toEqual(other);
  });
  it("uninstall tidies empty arrays/objects", () => {
    expect(uninstallHooks(installHooks({}, script))).toEqual({});
    expect(uninstallHooks(installHooks({ model: "x" }, script))).toEqual({ model: "x" });
  });
  it("uninstall keeps sibling hooks inside a shared group", () => {
    const shared = { hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }, { type: "command", command: `node "${script}" Stop` }] }] } };
    expect(uninstallHooks(shared)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } });
  });
});

describe("applyToFile (temp files only)", () => {
  let dir: string;
  let file: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "kt-hooks-")); file = path.join(dir, ".claude", "settings.json"); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("creates a missing file (and directory) without a backup", () => {
    const r = applyToFile(file, "install", script);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.backup).toBeUndefined();
    expect(count(JSON.parse(fs.readFileSync(file, "utf8")))).toBe(HOOK_EVENTS.length);
  });
  it("backs up an existing file byte-for-byte before writing", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = JSON.stringify(other, null, 2);
    fs.writeFileSync(file, original);
    const r = applyToFile(file, "install", script);
    expect(fs.readFileSync(r.backup!, "utf8")).toBe(original);
    expect(path.dirname(r.backup!)).toBe(path.dirname(file));
  });
  it("second install changes nothing; uninstall restores the original content", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(other, null, 2));
    applyToFile(file, "install", script);
    expect(applyToFile(file, "install", script).changed).toBe(false);
    applyToFile(file, "uninstall", script);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(other);
  });
  it("refuses to touch invalid JSON", () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ nope");
    const r = applyToFile(file, "install", script);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("{ nope");
  });
});

describe("hook command", () => {
  it("double-quotes the path", () => {
    expect(hookCommand("C:\\a b\\kyle-hook.js", "Stop")).toBe('node "C:\\a b\\kyle-hook.js" Stop');
  });
});

describe("planHookInstall / planHookUninstall (fixture settings)", () => {
  const fixtureOld = () => installHooks(clone(other), oldScript);

  it("fresh install adds all events and reports a change", () => {
    const p = planHookInstall(clone(other), script);
    expect(p.changed).toBe(true);
    expect(count(p.next)).toBe(HOOK_EVENTS.length);
    expect(JSON.stringify(p.next)).toContain("kyle-hub");
  });
  it("upgrade from kyle-term entries replaces them and keeps unrelated hooks", () => {
    const old = fixtureOld();
    expect(JSON.stringify(old)).toContain("kyle-term");
    const p = planHookInstall(clone(old), script);
    expect(p.changed).toBe(true);
    expect(JSON.stringify(p.next)).not.toContain("kyle-term");
    expect(count(p.next)).toBe(HOOK_EVENTS.length);
    const hooks = (p.next as typeof other).hooks;
    expect(hooks.Stop[0]).toEqual(other.hooks.Stop[0]);
    expect(hooks.PreToolUse[0]).toEqual(other.hooks.PreToolUse[0]);
  });
  it("re-running is a no-op", () => {
    const first = planHookInstall(clone(other), script).next;
    const again = planHookInstall(clone(first), script);
    expect(again.changed).toBe(false);
    expect(again.next).toEqual(first);
  });
  it("uninstall removes ours (kyle-hub and kyle-term) and leaves unrelated hooks untouched", () => {
    const mixed = installHooks(fixtureOld(), script);
    const p = planHookUninstall(clone(mixed));
    expect(p.changed).toBe(true);
    expect(p.next).toEqual(other);
    expect(planHookUninstall(clone(other)).changed).toBe(false);
  });
  it("does not treat a similarly named foreign hook as ours", () => {
    const foreign = { hooks: { Stop: [{ hooks: [{ type: "command", command: "node other-tool/kyle-hook.js Stop" }] }] } };
    expect(planHookUninstall(clone(foreign)).changed).toBe(false);
  });
});

describe("loadSettingsFile", () => {
  it("reads fixtures and rejects invalid JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-hooks-"));
    try {
      const f = path.join(dir, "settings.json");
      expect(loadSettingsFile(f)).toEqual({ ok: true, raw: null, current: {} });
      fs.writeFileSync(f, JSON.stringify(other));
      expect(loadSettingsFile(f)).toMatchObject({ ok: true, current: other });
      fs.writeFileSync(f, "[1]");
      expect(loadSettingsFile(f).ok).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("vault-scoped install (temp dirs only)", () => {
  it("writes the vault file, removes global entries, and is idempotent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kh-vault-install-"));
    try {
      const globalFile = path.join(dir, "home", "settings.json");
      const vaultFile = path.join(dir, "vault", ".claude", "settings.local.json");
      fs.mkdirSync(path.dirname(globalFile), { recursive: true });
      fs.writeFileSync(globalFile, JSON.stringify(installHooks({ model: "x" }, script)));
      expect(applyToFile(vaultFile, "install", script).changed).toBe(true);
      expect(applyToFile(globalFile, "uninstall", script).changed).toBe(true);
      expect(JSON.parse(fs.readFileSync(globalFile, "utf8"))).toEqual({ model: "x" });
      expect(count(JSON.parse(fs.readFileSync(vaultFile, "utf8")))).toBe(HOOK_EVENTS.length);
      const before = fs.readFileSync(vaultFile, "utf8");
      expect(applyToFile(vaultFile, "install", script).changed).toBe(false);
      expect(applyToFile(globalFile, "uninstall", script).changed).toBe(false);
      expect(fs.readFileSync(vaultFile, "utf8")).toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
