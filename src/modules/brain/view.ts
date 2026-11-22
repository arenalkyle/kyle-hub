import { ItemView } from "obsidian";

export const BRAIN_VIEW_TYPE = "kh-brain-view";

/** Placeholder until the brain view gains content. */
export class BrainView extends ItemView {
  getViewType(): string { return BRAIN_VIEW_TYPE; }
  getDisplayText(): string { return "Brain"; }
  override getIcon(): string { return "brain"; }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-brain-view");
    this.contentEl.createDiv({ cls: "kh-brain-empty", text: "Brain is coming soon." });
  }
}
