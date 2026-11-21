import { WorkspaceLeaf, type TFile, type View } from "obsidian";
import type KyleTicketsPlugin from "../main";
import { around } from "../core/around";
import { interceptTarget, isIssuePath, isProjectPath } from "../core/intercept";

export const VIEW_TYPE_ISSUE = "kyle-tickets-issue";
export const VIEW_TYPE_PROJECT = "kyle-tickets-project";

interface ViewStateLike {
  type?: string;
  state?: { file?: string } & Record<string, unknown>;
  [k: string]: unknown;
}

function fileOf(leaf: WorkspaceLeaf): string | undefined {
  const f = (leaf.getViewState().state as { file?: unknown } | undefined)?.file;
  return typeof f === "string" ? f : undefined;
}

/** Opens ticket files in the issue view and switches leaves between it and the Markdown editor. */
export class IssueInterceptor {
  /** Leaves explicitly switched to Markdown, with the path they were switched for. */
  private readonly forced = new WeakMap<WorkspaceLeaf, string>();
  private readonly actions = new WeakMap<View, HTMLElement>();

  constructor(private readonly plugin: KyleTicketsPlugin) {}

  install(): void {
    const self = this;
    const uninstall = around(WorkspaceLeaf.prototype as unknown as Record<string, unknown>, "setViewState", (old) =>
      function (this: WorkspaceLeaf, ...args: unknown[]) {
        const next = self.rewrite(this, args[0] as ViewStateLike | undefined);
        if (next) args[0] = next;
        return old.apply(this, args);
      },
    );
    this.plugin.register(uninstall);
    const sync = (): void => this.syncActions();
    const ws = this.plugin.app.workspace;
    this.plugin.registerEvent(ws.on("layout-change", sync));
    this.plugin.registerEvent(ws.on("file-open", sync));
    this.plugin.registerEvent(ws.on("active-leaf-change", sync));
    ws.onLayoutReady(sync);
    this.plugin.register(() => this.removeActions());
  }

  private rewrite(leaf: WorkspaceLeaf, state: ViewStateLike | undefined): ViewStateLike | null {
    if (!state || state.type !== "markdown") return null;
    const path = state.state?.file;
    if (typeof path !== "string") return null;
    const forcedPath = this.forced.get(leaf);
    if (forcedPath !== undefined && forcedPath !== path) this.forced.delete(leaf);
    const forcedMarkdown = this.forced.get(leaf) === path;
    const target = interceptTarget({ path, folder: this.plugin.data.settings.folder, forcedMarkdown });
    if (!target) return null;
    return { ...state, type: target === "issue" ? VIEW_TYPE_ISSUE : VIEW_TYPE_PROJECT, state: { file: path } };
  }

  /** Switches `leaf` (showing an issue file) to the Markdown editor. */
  async showMarkdown(leaf: WorkspaceLeaf): Promise<void> {
    const file = fileOf(leaf);
    if (file === undefined) return;
    this.forced.set(leaf, file);
    await leaf.setViewState({ type: "markdown", state: { file }, active: true });
  }

  /** Switches `leaf` (showing a ticket in the Markdown editor) back to the issue view. */
  async showIssue(leaf: WorkspaceLeaf): Promise<void> {
    const file = fileOf(leaf);
    if (file === undefined) return;
    this.forced.delete(leaf);
    await leaf.setViewState({ type: "markdown", state: { file }, active: true });
  }

  /** Command target: toggles the active leaf between issue view and Markdown. False when not applicable. */
  toggle(check: boolean): boolean {
    const leaf = this.plugin.app.workspace.getMostRecentLeaf();
    if (!leaf) return false;
    const type = leaf.view.getViewType();
    const file = (leaf.view as { file?: TFile | null }).file;
    const folder = this.plugin.data.settings.folder;
    const applicable =
      type === VIEW_TYPE_ISSUE ||
      type === VIEW_TYPE_PROJECT ||
      (type === "markdown" && !!file && (isIssuePath(file.path, folder) || isProjectPath(file.path, folder)));
    if (!applicable) return false;
    if (!check) void (type === VIEW_TYPE_ISSUE || type === VIEW_TYPE_PROJECT ? this.showMarkdown(leaf) : this.showIssue(leaf));
    return true;
  }

  /** Adds an "Open as issue" header button to Markdown views of ticket files (hidden for other files). */
  private syncActions(): void {
    const folder = this.plugin.data.settings.folder;
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      const file = (view as { file?: TFile | null }).file;
      const inFolder = !!file && (isIssuePath(file.path, folder) || isProjectPath(file.path, folder));
      let el = this.actions.get(view);
      if (!el && inFolder) {
        el = (view as unknown as { addAction(icon: string, title: string, cb: () => void): HTMLElement }).addAction(
          "layout-template",
          "Open in kyle-tickets view",
          () => void this.showIssue(leaf),
        );
        this.actions.set(view, el);
      }
      if (el) el.style.display = inFolder ? "" : "none";
    }
  }

  private removeActions(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) this.actions.get(leaf.view)?.remove();
  }
}
