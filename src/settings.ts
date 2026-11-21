import { PluginSettingTab, Setting, type App } from "obsidian";
import type KyleTermPlugin from "./main";
import { DEFAULT_SOUNDS, TONES, type AlertEvent, type SoundSettings } from "./alert";
import { AUDIO_EXTS } from "./sound";

export interface KyleTermSettings {
  nodePath: string;
  defaultProfile: string;
  /** Empty = vault root. */
  claudeStartFolder: string;
  claudeCommand: string;
  /** Seconds of quiet before a non-hook CLI session shows "finished". */
  idleSeconds: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sounds: SoundSettings;
}

export const DEFAULT_SETTINGS: KyleTermSettings = {
  nodePath: "",
  defaultProfile: "powershell",
  claudeStartFolder: "",
  claudeCommand: "claude",
  idleSeconds: 10,
  sidebarWidth: 240,
  sidebarCollapsed: false,
  sounds: DEFAULT_SOUNDS,
};

const EVENT_LABEL: Record<AlertEvent, string> = {
  "needs-input": "Needs input",
  finished: "Finished",
  "sub-agent-done": "Sub-agent done",
};
const TONE_LABEL: Record<string, string> = { chime: "Chime", ping: "Ping", bell: "Bell", pulse: "Pulse" };

/** Merge saved sound settings over defaults (deep, one level per event). */
export function mergeSounds(saved: Partial<SoundSettings> | undefined): SoundSettings {
  const d = DEFAULT_SOUNDS;
  return {
    muted: saved?.muted ?? d.muted,
    master: saved?.master ?? d.master,
    events: {
      "needs-input": { ...d.events["needs-input"], ...saved?.events?.["needs-input"] },
      finished: { ...d.events.finished, ...saved?.events?.finished },
      "sub-agent-done": { ...d.events["sub-agent-done"], ...saved?.events?.["sub-agent-done"] },
    },
  };
}

export class KyleTermSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KyleTermPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const el = this.containerEl;
    const s = this.plugin.settings;
    el.empty();
    new Setting(el)
      .setName("Node path")
      .setDesc("Path to node (18+). Leave empty to use node from PATH. Reload the plugin after changing.")
      .addText((t) =>
        t.setPlaceholder("node").setValue(s.nodePath).onChange(async (v) => {
          s.nodePath = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("Default shell profile")
      .setDesc("Shell used by new sessions. Only installed shells are listed.")
      .addDropdown((d) => {
        for (const p of this.plugin.profiles) d.addOption(p.id, p.name);
        d.setValue(this.plugin.profiles.some((p) => p.id === s.defaultProfile) ? s.defaultProfile : this.plugin.profiles[0]!.id);
        d.onChange(async (v) => {
          s.defaultProfile = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(el)
      .setName("Claude start folder")
      .setDesc("Folder where New Session starts. Leave empty for the vault root.")
      .addText((t) =>
        t.setPlaceholder("(vault root)").setValue(s.claudeStartFolder).onChange(async (v) => {
          s.claudeStartFolder = v.trim();
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("Claude command")
      .setDesc("Typed into the shell when starting a Claude session.")
      .addText((t) =>
        t.setPlaceholder("claude").setValue(s.claudeCommand).onChange(async (v) => {
          s.claudeCommand = v.trim() || "claude";
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("Idle timeout (seconds)")
      .setDesc("For CLIs without hooks (Codex, Gemini, Aider): quiet this long after output shows finished.")
      .addText((t) =>
        t.setPlaceholder("10").setValue(String(s.idleSeconds)).onChange(async (v) => {
          const n = Number(v);
          s.idleSeconds = Number.isFinite(n) && n >= 1 ? n : DEFAULT_SETTINGS.idleSeconds;
          await this.plugin.saveSettings();
        }),
      );
    this.displaySounds(el);
  }

  private displaySounds(el: HTMLElement): void {
    const snd = this.plugin.settings.sounds;
    const save = () => void this.plugin.saveSettings();
    new Setting(el).setName("Sounds").setHeading();
    new Setting(el).setName("Mute all sounds").addToggle((t) => t.setValue(snd.muted).onChange((v) => this.plugin.setMuted(v)));
    new Setting(el).setName("Master volume").addSlider((sl) =>
      sl.setLimits(0, 100, 1).setValue(snd.master).setDynamicTooltip().onChange((v) => { snd.master = v; save(); }),
    );
    const audioFiles = this.app.vault.getFiles().filter((f) => AUDIO_EXTS.includes(f.extension.toLowerCase()));
    for (const ev of Object.keys(EVENT_LABEL) as AlertEvent[]) {
      const cfg = snd.events[ev];
      const setting = new Setting(this.containerEl).setName(EVENT_LABEL[ev]);
      setting.addDropdown((d) => {
        d.addOption("none", "None");
        for (const t of TONES) d.addOption(t, TONE_LABEL[t]!);
        d.addOption("vault:", "Vault file…");
        d.setValue(cfg.sound.startsWith("vault:") ? "vault:" : cfg.sound);
        d.onChange((v) => {
          cfg.sound = v === "vault:" ? `vault:${cfg.sound.startsWith("vault:") ? cfg.sound.slice(6) : ""}` : v;
          save();
          this.display();
        });
      });
      if (cfg.sound.startsWith("vault:")) {
        const listId = `kt-audio-${ev}`;
        setting.addText((t) => {
          t.setPlaceholder("path/to/sound.mp3").setValue(cfg.sound.slice(6)).onChange((v) => {
            cfg.sound = `vault:${v.trim()}`;
            save();
          });
          t.inputEl.setAttribute("list", listId);
          const dl = createEl("datalist", { attr: { id: listId } });
          for (const f of audioFiles) dl.createEl("option", { attr: { value: f.path } });
          t.inputEl.after(dl);
        });
      }
      setting.addSlider((sl) =>
        sl.setLimits(0, 100, 1).setValue(cfg.volume).setDynamicTooltip().onChange((v) => { cfg.volume = v; save(); }),
      );
      setting.addButton((b) =>
        b.setButtonText("Preview").onClick(() => this.plugin.preview(cfg.sound, (snd.master / 100) * (cfg.volume / 100))),
      );
    }
  }
}
