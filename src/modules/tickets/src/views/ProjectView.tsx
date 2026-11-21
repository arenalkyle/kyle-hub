import { ItemView, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import { useProjects } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { VIEW_TYPE_PROJECT } from "./intercept";
import { ProjectPage } from "./project/ProjectPage";

export { VIEW_TYPE_PROJECT };

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const nameOfPath = (path: string): string => baseName(path).replace(/\.md$/i, "");

function ProjectApp({ path, leaf }: { path: string; leaf: WorkspaceLeaf }) {
  const plugin = usePlugin();
  const projects = useProjects();
  const byPath = projects.find((p) => p.fileName === baseName(path))?.name;
  const [name, setName] = useState(byPath ?? nameOfPath(path));
  // Follow the project when it was renamed elsewhere.
  useEffect(() => {
    if (byPath !== undefined) setName(byPath);
  }, [byPath]);
  return (
    <ProjectPage
      name={name}
      onRenamed={setName}
      onDeleted={() => leaf.detach()}
      extraMenu={(m) => m.addItem((i) => i.setTitle("Open as Markdown").setIcon("file-text").onClick(() => void plugin.interceptor.showMarkdown(leaf)))}
    />
  );
}

/** Project page for a project file opened directly (file explorer, links). */
export class ProjectView extends ItemView {
  private root: Root | null = null;
  private path = "";
  private unsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: KyleTicketsPlugin) {
    super(leaf);
    this.navigation = true;
  }

  override getViewType(): string {
    return VIEW_TYPE_PROJECT;
  }

  override getDisplayText(): string {
    return this.plugin.store.getProjects().find((p) => p.fileName === baseName(this.path))?.name ?? (nameOfPath(this.path) || "Project");
  }

  override getIcon(): string {
    return "box";
  }

  override getState(): Record<string, unknown> {
    return { file: this.path };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = (state as { file?: unknown } | null)?.file;
    if (typeof file === "string") {
      this.path = file;
      this.render();
      this.refreshHeader();
    }
    await super.setState(state, result);
  }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-tickets-root");
    this.root = createRoot(this.contentEl);
    this.render();
    this.unsub = this.plugin.store.on("change", () => this.refreshHeader());
    this.registerEvent(
      this.app.vault.on("rename", (f, old) => {
        if (old === this.path) {
          this.path = f.path;
          this.render();
          this.refreshHeader();
        }
      }),
    );
  }

  override async onClose(): Promise<void> {
    this.unsub?.();
    this.unsub = null;
    this.root?.unmount();
    this.root = null;
  }

  private refreshHeader(): void {
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }

  private render(): void {
    if (!this.root || !this.path) return;
    this.root.render(
      <StrictMode>
        <PluginContext.Provider value={this.plugin}>
          <ProjectApp path={this.path} leaf={this.leaf} />
        </PluginContext.Provider>
      </StrictMode>,
    );
  }
}
