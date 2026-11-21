import { ItemView, type WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import { useIssues } from "../store/hooks";
import { PluginContext } from "./PluginContext";

export const VIEW_TYPE_MAIN = "kyle-tickets-main";

function MainApp() {
  const issues = useIssues();
  return (
    <>
      <h2 className="kt-main-heading">kyle-tickets</h2>
      <p className="kt-main-count">{issues.length} issues</p>
    </>
  );
}

export class MainView extends ItemView {
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: KyleTicketsPlugin) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_MAIN;
  }

  override getDisplayText(): string {
    return "kyle-tickets";
  }

  override getIcon(): string {
    return "kanban-square";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kt-root");
    this.root = createRoot(this.contentEl);
    this.root.render(
      <StrictMode>
        <PluginContext.Provider value={this.plugin}>
          <MainApp />
        </PluginContext.Provider>
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
