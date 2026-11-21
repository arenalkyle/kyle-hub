import { FuzzySuggestModal, TFolder, type App } from "obsidian";

/** Pick any vault folder (vault-relative path; "/" is the root). */
export class FolderSuggest extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private choose: (f: TFolder) => void) {
    super(app);
    this.setPlaceholder("Choose a folder to start Claude in");
  }
  override getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
  }
  override getItemText(f: TFolder): string { return f.path; }
  override onChooseItem(f: TFolder): void { this.choose(f); }
}
