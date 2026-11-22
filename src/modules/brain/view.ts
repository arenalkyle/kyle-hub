import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { BrainHandle, Hub } from "../../core";

export const BRAIN_VIEW_TYPE = "kh-brain-view";

/** Full-size 3D brain: mounts the shared component from the brain service. */
export class BrainView extends ItemView {
  private handle: BrainHandle | undefined;

  constructor(leaf: WorkspaceLeaf, private readonly hub: Hub) {
    super(leaf);
  }

  getViewType(): string { return BRAIN_VIEW_TYPE; }
  getDisplayText(): string { return "Brain"; }
  override getIcon(): string { return "brain"; }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-brain-view");
    const host = this.contentEl.createDiv({ cls: "kh-brain-host kh-brain-host-full" });
    const svc = this.hub.services.get("brainView");
    if (!svc) host.createDiv({ cls: "kh-brain-empty", text: "3D brain unavailable." });
    else this.handle = svc.mount(host);
  }

  override async onClose(): Promise<void> {
    this.handle?.dispose();
    this.handle = undefined;
  }
}
