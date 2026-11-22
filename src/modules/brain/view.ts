import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { BrainHandle, Hub } from "../../core";
import { GapsPanel } from "./gapsPanel";

export const BRAIN_VIEW_TYPE = "kh-brain-view";

/** Full-size 3D brain beside a Gaps side panel (LOCK-72). */
export class BrainView extends ItemView {
  private handle: BrainHandle | undefined;
  private gaps: GapsPanel | undefined;

  constructor(leaf: WorkspaceLeaf, private readonly hub: Hub) {
    super(leaf);
  }

  getViewType(): string { return BRAIN_VIEW_TYPE; }
  getDisplayText(): string { return "Brain"; }
  override getIcon(): string { return "brain"; }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-brain-view");
    const split = this.contentEl.createDiv({ cls: "kh-brain-split" });
    const host = split.createDiv({ cls: "kh-brain-host kh-brain-host-full" });
    const svc = this.hub.services.get("brainView");
    if (!svc) host.createDiv({ cls: "kh-brain-empty", text: "3D brain unavailable." });
    else this.handle = svc.mount(host);
    this.gaps = new GapsPanel(split.createDiv({ cls: "kh-brain-gaps" }), this.hub.services.get("gaps"), (p) => this.selectNote(p));
    this.gaps.mount();
  }

  override async onClose(): Promise<void> {
    this.gaps?.dispose();
    this.gaps = undefined;
    this.handle?.dispose();
    this.handle = undefined;
  }

  /** Row selection: highlights the note on the brain and opens it. */
  private selectNote(notePath: string): void {
    this.handle?.highlight(notePath);
    void this.app.workspace.openLinkText(notePath, "", false);
  }
}
