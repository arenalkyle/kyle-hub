import { resolveNode } from "./node-path";
import { FuzzySuggestModal, Setting, type App, type TFile } from "obsidian";
import type { SettingsSection } from "../../../core";
import { resolveRetroSettings } from "../retro/settings";
import fs from "node:fs";
import type TermHost from "./main";
import { TONES, type AlertEvent } from "./alert";
import { DEFAULT_SETTINGS } from "./schema";
import { AUDIO_EXTS } from "./sound";
import {
  ANSI_KEYS, DEFAULT_APPEARANCE, DEFAULT_FONT_FAMILY, MAX_FONT, MIN_FONT, PRESETS, THEME_CUSTOM, THEME_FOLLOW, clampFont, toHex,
  type AppearanceSettings,
} from "./appearance";

const EVENT_LABEL: Record<AlertEvent, string> = {
  "needs-input": "Needs input",
  finished: "Finished",
  "sub-agent-done": "Sub-agent done",
};
const TONE_LABEL: Record<string, string> = { chime: "Chime", ping: "Ping", bell: "Bell", pulse: "Pulse" };

/** Merge saved sound settings over defaults (deep, one level per event). */
/** The terminal block inside kyle-hub's settings tab. */
export class TermSettingsSection implements SettingsSection {
  private containerEl!: HTMLElement;
  private app: App;

  constructor(private plugin: TermHost) {
    this.app = plugin.app;
  }

  render(el: HTMLElement): void {
    this.containerEl = el;
    this.display();
  }

  display(): void {
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
    const det = resolveNode(s.nodePath);
    new Setting(el)
      .setName("Detected Node / PATH")
      .setDesc(`Node: ${det.ok ? det.path : "not found"}
PATH: ${process.env.PATH ?? ""}`)
      .descEl.style.whiteSpace = "pre-wrap";
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
    new Setting(el)
      .setName("Restore scrollback")
      .setDesc("Save each terminal's output so it shows (greyed out) after restarting Obsidian. Turning this off deletes saved output; sessions and Resume still work.")
      .addToggle((t) => t.setValue(s.restoreScrollback).onChange((v) => this.plugin.setRestoreScrollback(v)));
    new Setting(el)
      .setName("Scrollback lines to restore")
      .addText((t) =>
        t.setPlaceholder("2000").setValue(String(s.scrollbackLines)).onChange(async (v) => {
          const n = Math.floor(Number(v));
          s.scrollbackLines = Number.isFinite(n) && n >= 100 ? Math.min(n, 20000) : DEFAULT_SETTINGS.scrollbackLines;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(el)
      .setName("@path references")
      .setDesc("Send note, drag-and-drop: relative to the session's folder when possible, or always absolute. Notes outside the folder are always absolute.")
      .addDropdown((d) =>
        d.addOption("relative", "Relative when possible").addOption("absolute", "Always absolute").setValue(s.pathMode).onChange(async (v) => {
          s.pathMode = v === "absolute" ? "absolute" : "relative";
          await this.plugin.saveSettings();
        }),
      );
    this.displayFolders(el);
    this.displayRetro(el);
    this.displayAppearance(el);
    this.displaySounds(el);
  }

  private displayRetro(el: HTMLElement): void {
    const raw = this.plugin.settings as unknown as { retro?: Record<string, unknown> };
    const r = (raw.retro ??= {});
    const cur = resolveRetroSettings(r);
    new Setting(el).setName("Retro").setHeading();
    const num = (name: string, desc: string, key: "nudgeAt" | "maxTickets" | "dailyCapUsd", float = false): void => {
      new Setting(el).setName(name).setDesc(desc).addText((t) =>
        t.setValue(String(cur[key])).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) r[key] = float ? n : Math.floor(n);
          else delete r[key];
          await this.plugin.saveSettings();
        }),
      );
    };
    num("Nudge at (sessions)", "Highlight the sessions-since-last-retro count from this many sessions.", "nudgeAt");
    num("Max tickets per retro", "New proposal and finding tickets one retro may create.", "maxTickets");
    new Setting(el)
      .setName("Draft rule with Haiku")
      .setDesc("Off by default. Shows a button on user-correction findings that sends the pattern, counts and up to 3 redacted excerpts to claude -p --model haiku.")
      .addToggle((t) =>
        t.setValue(cur.allowDraftRule).onChange(async (v) => {
          r.allowDraftRule = v;
          await this.plugin.saveSettings();
        }),
      );
    num("Daily Haiku cap (USD)", "Draft rule refuses once today's spend reaches this.", "dailyCapUsd", true);
  }

  private displayFolders(el: HTMLElement): void {
    const s = this.plugin.settings;
    new Setting(el).setName("Saved folders").setHeading();
    el.createEl("p", { cls: "setting-item-description", text: "Folders offered when you right-click New Session. Absolute paths; repos outside the vault work." });
    const save = () => void this.plugin.saveSettings();
    s.savedFolders.forEach((f, i) => {
      const row = new Setting(el);
      row.addText((t) => t.setPlaceholder("Name").setValue(f.name).onChange((v) => { f.name = v; save(); }));
      row.addText((t) => {
        t.setPlaceholder("C:/path/to/folder").setValue(f.path);
        const warn = () => {
          const bad = f.path.trim() !== "" && !folderExists(f.path);
          t.inputEl.toggleClass("mod-warning", bad);
          t.inputEl.title = bad ? "Folder does not exist" : "";
          warnEl.setText(bad ? "Folder does not exist" : "");
        };
        t.onChange((v) => { f.path = v.trim(); save(); warn(); });
        const warnEl = row.descEl;
        warnEl.addClass("mod-warning");
        warn();
      });
      row.addExtraButton((b) => b.setIcon("arrow-up").setTooltip("Move up").setDisabled(i === 0).onClick(() => { this.swap(i, i - 1); }));
      row.addExtraButton((b) => b.setIcon("arrow-down").setTooltip("Move down").setDisabled(i === s.savedFolders.length - 1).onClick(() => { this.swap(i, i + 1); }));
      row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove").onClick(() => { s.savedFolders.splice(i, 1); save(); this.display(); }));
    });
    new Setting(el).addButton((b) =>
      b.setButtonText("Add folder").onClick(() => {
        s.savedFolders.push({ name: "", path: "" });
        save();
        this.display();
      }),
    );
  }

  private swap(a: number, b: number): void {
    const l = this.plugin.settings.savedFolders;
    [l[a], l[b]] = [l[b]!, l[a]!];
    void this.plugin.saveSettings();
    this.display();
  }

  private displayAppearance(el: HTMLElement): void {
    const a: AppearanceSettings = this.plugin.settings.appearance;
    const apply = (notify = false) => { this.plugin.applyAppearance(notify); void this.plugin.saveSettings(); };
    new Setting(el).setName("Appearance").setHeading();
    new Setting(el).setName("Colour theme").addDropdown((d) => {
      d.addOption(THEME_FOLLOW, "Follow Obsidian");
      for (const p of PRESETS) d.addOption(p.id, p.name);
      d.addOption(THEME_CUSTOM, "Custom");
      d.setValue(a.theme).onChange((v) => { a.theme = v; apply(); this.display(); });
    });
    if (a.theme === THEME_CUSTOM) {
      new Setting(el).setName("Start from preset").setDesc("Copies a preset into the custom palette.").addDropdown((d) => {
        d.addOption("", "Choose…");
        for (const p of PRESETS) d.addOption(p.id, p.name);
        d.onChange((v) => {
          const p = PRESETS.find((x) => x.id === v);
          if (!p) return;
          a.custom = structuredClone(p.palette);
          apply();
          this.display();
        });
      });
      const picker = (name: string, get: () => string, set: (v: string) => void) =>
        new Setting(el).setName(name).addColorPicker((c) => c.setValue(toHex(get())).onChange((v) => { set(v); apply(); }));
      picker("Background", () => a.custom.background, (v) => (a.custom.background = v));
      picker("Foreground", () => a.custom.foreground, (v) => (a.custom.foreground = v));
      picker("Cursor", () => a.custom.cursor, (v) => (a.custom.cursor = v));
      picker("Selection", () => a.custom.selection, (v) => (a.custom.selection = v));
      ANSI_KEYS.forEach((k, i) => picker(`ANSI ${i}: ${k}`, () => a.custom.ansi[i]!, (v) => (a.custom.ansi[i] = v)));
    }
    new Setting(el)
      .setName("Font family")
      .setDesc("Leave empty to use Obsidian's monospace font (Appearance → Font). Otherwise a CSS font list.")
      .addText((t) =>
        t.setPlaceholder("Obsidian monospace font").setValue(a.fontFamily === DEFAULT_FONT_FAMILY ? "" : a.fontFamily).onChange((v) => { a.fontFamily = v.trim(); apply(); }),
      );
    new Setting(el)
      .setName("Font size")
      .setDesc(`${MIN_FONT}-${MAX_FONT}. Ctrl+= / Ctrl+- / Ctrl+0 zoom a single session.`)
      .addText((t) =>
        t.setValue(String(a.fontSize)).onChange((v) => {
          const n = Number(v);
          if (!Number.isFinite(n) || v.trim() === "") return;
          a.fontSize = clampFont(n);
          apply();
        }),
      );
    new Setting(el)
      .setName("Background image")
      .setDesc("A vault image, or paste an absolute file path.")
      .addText((t) =>
        t.setPlaceholder("C:/path/to/image.jpg").setValue(a.bgImage.replace(/^vault:/, "")).onChange((v) => {
          const x = v.trim();
          a.bgImage = x && this.app.vault.getAbstractFileByPath(x) ? `vault:${x}` : x;
          apply();
        }),
      )
      .addButton((b) => b.setButtonText("Pick from vault").onClick(() => {
        new ImageSuggest(this.app, (f) => { a.bgImage = `vault:${f.path}`; apply(true); this.display(); }).open();
      }))
      .addButton((b) => b.setButtonText("Clear").onClick(() => { a.bgImage = ""; apply(); this.display(); }));
    const slider = (name: string, desc: string, key: "imageOpacity" | "imageBlur" | "imageDim" | "terminalOpacity") =>
      new Setting(el).setName(name).setDesc(desc).addSlider((sl) =>
        sl.setLimits(0, 100, 1).setValue(a[key]).setDynamicTooltip().onChange((v) => { a[key] = v; apply(); }),
      );
    slider("Image opacity", "How visible the photo is.", "imageOpacity");
    slider("Image blur", "0 to 20 px.", "imageBlur");
    slider("Image dim", "Dark overlay over the photo for readability.", "imageDim");
    slider("Terminal background opacity", "100% hides the image completely.", "terminalOpacity");
    new Setting(el).addButton((b) =>
      b.setButtonText("Reset appearance").onClick(() => {
        Object.assign(a, structuredClone(DEFAULT_APPEARANCE));
        apply();
        this.display();
      }),
    );
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
        const listId = `kh-term-audio-${ev}`;
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

function folderExists(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

class ImageSuggest extends FuzzySuggestModal<TFile> {
  constructor(app: App, private choose: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("Pick a background image");
  }
  override getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXTS.includes(f.extension.toLowerCase()));
  }
  override getItemText(f: TFile): string { return f.path; }
  override onChooseItem(f: TFile): void {
    this.choose(f);
  }
}
