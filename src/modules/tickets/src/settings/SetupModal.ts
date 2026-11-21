import { AbstractInputSuggest, App, Modal, Setting, TFolder } from "obsidian";
import { normalizeFolder, validateFolder, validatePrefix } from "./validate";

export interface SetupResult {
  folder: string;
  prefix: string;
  displayName: string;
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, private readonly input: HTMLInputElement) {
    super(app, input);
  }

  protected override getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(q))
      .slice(0, 20);
  }

  override renderSuggestion(f: TFolder, el: HTMLElement): void {
    el.setText(f.path);
  }

  override selectSuggestion(f: TFolder): void {
    this.input.value = f.path;
    this.input.dispatchEvent(new Event("input"));
    this.close();
  }
}

export class SetupModal extends Modal {
  constructor(
    app: App,
    private readonly initial: SetupResult,
    private readonly onSubmit: (r: SetupResult) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle("Set up kyle-tickets");
    const v = { ...this.initial };

    let folderErr!: HTMLElement;
    let prefixErr!: HTMLElement;
    const refresh = (): boolean => {
      const fe = validateFolder(normalizeFolder(v.folder));
      const pe = validatePrefix(v.prefix);
      folderErr.setText(fe ?? "");
      prefixErr.setText(pe ?? "");
      return !fe && !pe;
    };

    const folderSetting = new Setting(contentEl)
      .setName("Tickets folder")
      .setDesc("Where issues and projects are stored.")
      .addText((t) => {
        t.setValue(v.folder).onChange((x) => {
          v.folder = x;
          refresh();
        });
        new FolderSuggest(this.app, t.inputEl);
      });
    folderErr = folderSetting.descEl.createDiv({ cls: "kh-tickets-error" });

    const prefixSetting = new Setting(contentEl)
      .setName("ID prefix")
      .setDesc("Uppercase letters, e.g. TIX gives TIX-1.")
      .addText((t) =>
        t.setValue(v.prefix).onChange((x) => {
          v.prefix = x;
          refresh();
        }),
      );
    prefixErr = prefixSetting.descEl.createDiv({ cls: "kh-tickets-error" });

    new Setting(contentEl)
      .setName("Display name")
      .setDesc("Used as @author for your comments and activity.")
      .addText((t) => t.setValue(v.displayName).onChange((x) => (v.displayName = x)));

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Create")
        .setCta()
        .onClick(async () => {
          if (!refresh()) return;
          const result = {
            folder: normalizeFolder(v.folder),
            prefix: v.prefix,
            displayName: v.displayName.trim() || "kyle",
          };
          this.close();
          await this.onSubmit(result);
        }),
    );
    refresh();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
