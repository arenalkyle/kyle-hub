import type { Command, EventRef, MarkdownPostProcessor, Plugin, View, WorkspaceLeaf } from "obsidian";
import type { ModuleData, ModuleId, SettingsRegistry } from "./settings";

/** A module's block inside the kyle-hub settings tab. */
export interface SettingsSection {
  render(el: HTMLElement): void;
  cleanup?(): void;
}

export type SectionRegistry = Map<ModuleId, SettingsSection>;

/**
 * What core hands each module instead of the Plugin: everything a module registers goes
 * through here, so `dispose()` can tear it all down when the module is switched off.
 */
export interface ModuleContext {
  readonly id: ModuleId;
  settings: {
    get<T extends object = ModuleData>(): T & ModuleData;
    update(patch: Record<string, unknown>): Promise<void>;
  };
  registerView(type: string, creator: (leaf: WorkspaceLeaf) => View): void;
  addCommand(command: Command): void;
  addRibbonIcon(icon: string, title: string, cb: (evt: MouseEvent) => void): void;
  registerEvent(ref: EventRef): void;
  /** Runs `cb` on dispose. */
  register(cb: () => unknown): void;
  registerInterval(id: number): number;
  registerMarkdownPostProcessor(fn: MarkdownPostProcessor): void;
  addSettingsSection(section: SettingsSection): void;
  /** Runs registered teardowns (reverse order); safe to call twice. */
  dispose(): void;
}

interface InternalApp {
  viewRegistry?: { unregisterView?(type: string): void };
}

export function createModuleContext(
  id: ModuleId,
  plugin: Plugin,
  settings: SettingsRegistry,
  save: () => Promise<void>,
  sections: SectionRegistry,
): ModuleContext {
  let teardowns: (() => unknown)[] = [];
  const onDispose = (fn: () => unknown): void => void teardowns.push(fn);
  return {
    id,
    settings: {
      get: <T extends object>() => settings.module(id) as unknown as T & ModuleData,
      async update(patch) {
        Object.assign(settings.module(id), patch);
        await save();
      },
    },
    registerView(type, creator) {
      plugin.registerView(type, creator);
      onDispose(() => {
        plugin.app.workspace.detachLeavesOfType(type);
        (plugin.app as unknown as InternalApp).viewRegistry?.unregisterView?.(type);
      });
    },
    addCommand(command) {
      plugin.addCommand(command);
      onDispose(() => (plugin.app as any).commands?.removeCommand?.(`${plugin.manifest.id}:${command.id}`));
    },
    addRibbonIcon(icon, title, cb) {
      const el = plugin.addRibbonIcon(icon, title, cb);
      onDispose(() => el.remove());
    },
    registerEvent(ref) {
      plugin.registerEvent(ref);
      onDispose(() => {
        // The ref remembers its emitter internally; otherwise try the three that modules use.
        const e = (ref as unknown as { e?: { offref(r: EventRef): void } }).e;
        if (e) e.offref(ref);
        else for (const em of [plugin.app.workspace, plugin.app.vault, plugin.app.metadataCache]) em.offref(ref);
      });
    },
    register(cb) {
      onDispose(cb);
    },
    registerInterval(n) {
      plugin.registerInterval(n);
      onDispose(() => window.clearInterval(n));
      return n;
    },
    registerMarkdownPostProcessor(fn) {
      const p = plugin.registerMarkdownPostProcessor(fn);
      // Lazy: keeps this file importable without the obsidian runtime (unit tests).
      onDispose(() => require("obsidian").MarkdownPreviewRenderer.unregisterPostProcessor(p));
    },
    addSettingsSection(section) {
      sections.set(id, section);
      onDispose(() => {
        section.cleanup?.();
        if (sections.get(id) === section) sections.delete(id);
      });
    },
    dispose() {
      const run = teardowns.reverse();
      teardowns = [];
      for (const fn of run) {
        try {
          void fn();
        } catch (e) {
          console.error(`kyle-hub: ${id} teardown failed`, e);
        }
      }
    },
  };
}
