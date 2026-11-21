import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./events";
import { createHubParts, loadModules, type Hub, type HubModule } from "./hub";
import { dataDir, pluginDir } from "./paths";
import { redact } from "./redact";
import { ServiceRegistry } from "./services";
import { SettingsRegistry } from "./settings";

describe("ServiceRegistry", () => {
  it("returns registered impl and undefined for missing", () => {
    const r = new ServiceRegistry();
    expect(r.get("tickets")).toBeUndefined();
    const impl = {} as never;
    r.register("tickets", impl);
    expect(r.get("tickets")).toBe(impl);
    expect(r.get("brain")).toBeUndefined();
    r.unregister("tickets");
    expect(r.get("tickets")).toBeUndefined();
  });
});

describe("EventBus", () => {
  it("emits typed payloads, supports off and unsubscribe", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("ticket:created", a);
    const off = bus.on("ticket:created", b);
    bus.emit("ticket:created", { id: "T-1" });
    expect(a).toHaveBeenCalledWith({ id: "T-1" });
    off();
    bus.off("ticket:created", a);
    bus.emit("ticket:created", { id: "T-2" });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("a throwing handler does not block others", () => {
    const bus = new EventBus();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = vi.fn();
    bus.on("session:ended", () => { throw new Error("x"); });
    bus.on("session:ended", ok);
    bus.emit("session:ended", { sessionId: "s" });
    expect(ok).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("SettingsRegistry", () => {
  it("merges defaults without clobbering stored values; core always enabled", () => {
    const s = new SettingsRegistry();
    s.register({ id: "core", defaults: {} });
    s.register({ id: "tickets", defaults: { a: 1, nested: { x: 1, y: 2 } } });
    s.register({ id: "brain", defaults: {}, enabledByDefault: false });
    const d = s.load({ modules: { core: { enabled: false }, tickets: { a: 5, nested: { x: 9 } } } });
    expect(d.modules.tickets).toEqual({ enabled: true, a: 5, nested: { x: 9, y: 2 } });
    expect(d.modules.brain.enabled).toBe(false);
    expect(s.isEnabled("core")).toBe(true);
    expect(s.isEnabled("term")).toBe(false);
  });
  it("applies migrations in schemaVersion order, only newer than stored", () => {
    const order: string[] = [];
    const s = new SettingsRegistry();
    s.register({
      id: "tickets",
      defaults: {},
      migrations: [
        { to: 3, run: (d) => { order.push("t3"); return { ...d, v3: true }; } },
        { to: 2, run: (d) => { order.push("t2"); return { ...d, v2: true }; } },
      ],
    });
    s.register({ id: "term", defaults: {}, migrations: [{ to: 2, run: (d) => { order.push("m2"); return d; } }] });
    const d = s.load({ schemaVersion: 1, modules: {} });
    expect(order).toEqual(["t2", "t3", "m2"]);
    expect(d.schemaVersion).toBe(3);
    expect(d.modules.tickets).toMatchObject({ v2: true, v3: true });
    order.length = 0;
    s.load({ schemaVersion: 2, modules: {} });
    expect(order).toEqual(["t3"]);
    order.length = 0;
    s.load({ schemaVersion: 3, modules: {} });
    expect(order).toEqual([]);
  });
  it("handles missing or garbage input", () => {
    const s = new SettingsRegistry();
    s.register({ id: "tickets", defaults: { a: 1 } });
    expect(s.load(null).modules.tickets).toEqual({ enabled: true, a: 1 });
    expect(s.load("junk").schemaVersion).toBe(1);
  });
});

describe("paths", () => {
  it("resolves LOCALAPPDATA/kyle-hub/<profile>", () => {
    const deps = { env: { LOCALAPPDATA: "C:\L" }, homedir: () => "C:\H" };
    expect(dataDir("work", deps)).toBe(path.join("C:\L", "kyle-hub", "work"));
    expect(dataDir(undefined, deps)).toBe(path.join("C:\L", "kyle-hub", "default"));
    expect(dataDir("p", { env: {}, homedir: () => "C:\H" })).toBe(path.join("C:\H", "AppData", "Local", "kyle-hub", "p"));
  });
  it("resolves plugin dir", () => {
    expect(pluginDir("V")).toBe(path.join("V", ".obsidian", "plugins", "kyle-hub"));
  });
});

describe("redact", () => {
  it("applies rules in order; no rules is identity", () => {
    expect(redact("abc")).toBe("abc");
    expect(redact("key=sk-1", [{ name: "k", pattern: /sk-\d+/g, replacement: "[x]" }])).toBe("key=[x]");
  });
});

describe("loadModules", () => {
  const mk = (id: HubModule["id"]) => ({ id, load: vi.fn() });
  it("skips disabled modules and never calls their load", async () => {
    const parts = createHubParts();
    parts.settings.register({ id: "tickets", defaults: {} });
    parts.settings.register({ id: "term", defaults: {}, enabledByDefault: false });
    parts.settings.load({});
    const hub = { app: {} as never, ...parts, save: async () => {} } satisfies Hub;
    const a = mk("tickets");
    const b = mk("term");
    const loaded = await loadModules(hub, [a, b]);
    expect(a.load).toHaveBeenCalledWith(hub, undefined);
    expect(b.load).not.toHaveBeenCalled();
    expect(loaded).toEqual([a]);
  });
});

describe("createModuleContext", () => {
  it("dispose tears down commands, views, events, ribbon and sections once", async () => {
    const { createModuleContext } = await import("./context");
    const removeCommand = vi.fn();
    const detach = vi.fn();
    const unregisterView = vi.fn();
    const offref = vi.fn();
    const ribbon = { remove: vi.fn() };
    const plugin = {
      manifest: { id: "kyle-hub" },
      app: { workspace: { detachLeavesOfType: detach, offref }, vault: { offref }, metadataCache: { offref }, commands: { removeCommand }, viewRegistry: { unregisterView } },
      registerView: vi.fn(),
      addCommand: vi.fn(),
      addRibbonIcon: vi.fn(() => ribbon),
      registerEvent: vi.fn(),
    };
    const settings = new SettingsRegistry();
    settings.register({ id: "tickets", defaults: { a: 1 } });
    settings.load({});
    const save = vi.fn(async () => {});
    const sections = new Map();
    const ctx = createModuleContext("tickets", plugin as never, settings, save, sections);
    ctx.registerView("v", (() => ({})) as never);
    ctx.addCommand({ id: "c", name: "C", callback: () => {} });
    ctx.addRibbonIcon("x", "t", () => {});
    ctx.registerEvent({} as never);
    ctx.addSettingsSection({ render: () => {} });
    const cleanup = vi.fn();
    ctx.register(cleanup);
    await ctx.settings.update({ a: 2 });
    expect(settings.module("tickets").a).toBe(2);
    expect(save).toHaveBeenCalled();
    expect(sections.size).toBe(1);
    ctx.dispose();
    ctx.dispose();
    expect(removeCommand).toHaveBeenCalledOnce();
    expect(removeCommand).toHaveBeenCalledWith("kyle-hub:c");
    expect(detach).toHaveBeenCalledWith("v");
    expect(unregisterView).toHaveBeenCalledWith("v");
    expect(ribbon.remove).toHaveBeenCalledOnce();
    expect(offref).toHaveBeenCalledTimes(3);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(sections.size).toBe(0);
  });
});
