import { Modal, Notice, Setting, type App } from "obsidian";
import { createElement, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PluginContext } from "../views/PluginContext";
import { LabelsEditor } from "./LabelsEditor";
import { StatusesEditor } from "./StatusesEditor";
import type KyleTicketsPlugin from "../main";
import { checkGh } from "../github/gh";
import { FolderSuggest } from "./SetupModal";
import { normalizeFolder, validateFolder, validatePrefix } from "./validate";

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly message: string,
    private readonly onYes: () => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("kyle-tickets");
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((b) =>
        b
          .setButtonText("Create structure")
          .setCta()
          .onClick(async () => {
            this.close();
            await this.onYes();
          }),
      )
      .addButton((b) => b.setButtonText("Not now").onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** The tickets block of the kyle-hub settings tab; `containerEl` is set by the hub tab before `display()`. */
export class KyleTicketsSettingTab {
  containerEl!: HTMLElement;
  private roots: Root[] = [];

  constructor(
    readonly app: App,
    private readonly plugin: KyleTicketsPlugin,
  ) {}

  display(): void {
    const { containerEl } = this;
    this.unmount();
    containerEl.empty();
    const s = this.plugin.data.settings;

    new Setting(containerEl)
      .setName("Tickets folder")
      .setDesc("Changing this does not move existing files.")
      .addText((t) => {
        t.setValue(s.folder).onChange(async (x) => {
          const folder = normalizeFolder(x);
          const err = validateFolder(folder);
          t.inputEl.toggleClass("kh-tickets-invalid", err !== null);
          if (err || folder === this.plugin.data.settings.folder) return;
          this.plugin.data.settings.folder = folder;
          await this.plugin.savePluginData();
        });
        t.inputEl.addEventListener("blur", () => void this.offerStructure());
        new FolderSuggest(this.app, t.inputEl);
      });

    new Setting(containerEl)
      .setName("ID prefix")
      .setDesc("Uppercase letters/digits, starting with a letter. Applies to new issues.")
      .addText((t) =>
        t.setValue(s.prefix).onChange(async (x) => {
          const err = validatePrefix(x);
          t.inputEl.toggleClass("kh-tickets-invalid", err !== null);
          if (err) return;
          this.plugin.data.settings.prefix = x;
          await this.plugin.savePluginData();
        }),
      );

    new Setting(containerEl)
      .setName("Display name")
      .setDesc("Default @author for comments and activity.")
      .addText((t) =>
        t.setValue(s.displayName).onChange(async (x) => {
          this.plugin.data.settings.displayName = x.trim() || "kyle";
          await this.plugin.savePluginData();
        }),
      );

    this.githubSection(containerEl);

    this.mountEditor("Statuses", "Drag to reorder. Renaming or deleting rewrites every issue that uses the status.", StatusesEditor);
    this.mountEditor("Labels", "Every label used by an issue. Renaming or deleting rewrites those issues.", LabelsEditor);
  }

  private githubSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("GitHub").setHeading();
    const status = new Setting(containerEl).setName("GitHub CLI").setDesc("Checking gh...");
    const check = async (): Promise<void> => {
      status.setDesc("Checking gh...");
      const r = await checkGh({ bin: this.plugin.data.settings.ghPath, timeoutMs: 10000 });
      status.setDesc(r.message);
      status.descEl.toggleClass("kh-tickets-gh-ok", r.ok);
      status.descEl.toggleClass("kh-tickets-gh-bad", !r.ok);
      this.plugin.prs.resetAvailability();
      if (r.ok) void this.plugin.prs.refreshAll();
    };
    status.addButton((b) => b.setButtonText("Re-check").onClick(() => void check()));
    void check();

    new Setting(containerEl)
      .setName("gh path")
      .setDesc("Optional. Full path to the gh executable if it is not on PATH (leave empty to use PATH).")
      .addText((t) =>
        t
          .setPlaceholder("gh")
          .setValue(this.plugin.data.settings.ghPath)
          .onChange(async (x) => {
            await this.plugin.updateSettings({ ghPath: x.trim() });
          }),
      );

    new Setting(containerEl)
      .setName("PR refresh interval (minutes)")
      .setDesc("How often open and draft pull requests are re-checked in the background. Linked PR states also refresh when an issue page opens.")
      .addText((t) =>
        t
          .setValue(String(this.plugin.data.settings.prRefreshMinutes))
          .onChange(async (x) => {
            const n = Number(x);
            const ok = Number.isFinite(n) && n >= 1 && n <= 1440;
            t.inputEl.toggleClass("kh-tickets-invalid", !ok);
            if (!ok) return;
            await this.plugin.updateSettings({ prRefreshMinutes: Math.round(n) });
          }),
      );

    this.autoLinkSection(containerEl);
  }

  private autoLinkSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Watched repos")
      .setDesc("owner/repo, one per line. PRs whose title or branch contains an issue ID are linked to that issue.")
      .addTextArea((t) => {
        t.setPlaceholder("owner/repo")
          .setValue(this.plugin.data.settings.ghRepos.join("\n"))
          .onChange(async (x) => {
            const repos = x.split("\n").map((r) => r.trim()).filter(Boolean);
            await this.plugin.updateSettings({ ghRepos: repos });
          });
        t.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("Auto-link PRs")
      .setDesc("Periodically link PRs in the watched repos (on the refresh interval).")
      .addToggle((t) =>
        t.setValue(this.plugin.data.settings.autoLinkPrs).onChange(async (v) => {
          await this.plugin.updateSettings({ autoLinkPrs: v });
          if (v) void this.plugin.autoLinker.tick();
        }),
      );

    const last = (): string => {
      const r = this.plugin.data.autoLink;
      return r ? `${r.message} · ${relativeAgo(r.at)}` : "Not synced yet.";
    };
    const sync = new Setting(containerEl).setName("Sync now").setDesc(last());
    sync.descEl.toggleClass("kh-tickets-gh-bad", this.plugin.data.autoLink?.ok === false);
    sync.addButton((b) =>
      b.setButtonText("Sync now").onClick(async () => {
        b.setDisabled(true);
        sync.setDesc("Syncing...");
        const r = await this.plugin.autoLinker.sync();
        sync.setDesc(r ? last() : "A sync is already running.");
        sync.descEl.toggleClass("kh-tickets-gh-bad", r?.ok === false);
        b.setDisabled(false);
      }),
    );
  }

  hide(): void {
    this.unmount();
  }

  private unmount(): void {
    for (const r of this.roots) r.unmount();
    this.roots = [];
  }

  private mountEditor(name: string, desc: string, component: () => ReactElement): void {
    const { containerEl } = this;
    new Setting(containerEl).setName(name).setDesc(desc).setHeading();
    const root = createRoot(containerEl.createDiv({ cls: "kh-tickets-set-host" }));
    this.roots.push(root);
    root.render(
      createElement(StrictMode, null, createElement(PluginContext.Provider, { value: this.plugin }, createElement(component))),
    );
  }

  private async offerStructure(): Promise<void> {
    const { folder } = this.plugin.data.settings;
    if (await this.app.vault.adapter.exists(`${folder}/Issues`)) return;
    new ConfirmModal(this.app, `Create the kyle-tickets structure in "${folder}"?`, async () => {
      await this.plugin.bootstrap();
      new Notice(`kyle-tickets: created structure in ${folder}`);
    }).open();
  }
}

function relativeAgo(at: number): string {
  const m = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
