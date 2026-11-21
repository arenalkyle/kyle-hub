import { ItemView, Notice, TFile, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import type { IssuePatch } from "../core/issueFile";
import { fromLink } from "../core/links";
import { useIssue, useIssues, useSettings, useStoreReady } from "../store/hooks";
import { confirmModal } from "../settings/modals";
import { PluginContext, usePlugin } from "./PluginContext";
import { ActivityFeed } from "./issue/ActivityFeed";
import { CommentBox } from "./issue/CommentBox";
import { Description } from "./issue/Description";
import { TitleEditor } from "./issue/TitleEditor";
import { IssueHeader } from "./issue/IssueHeader";
import { SubIssues } from "./issue/SubIssues";
import { PropertiesSidebar, type PropKind } from "./issue/PropertiesSidebar";
import { VIEW_TYPE_ISSUE } from "./intercept";
import { useShortcuts, type ShortcutAction } from "./shortcuts";

export { VIEW_TYPE_ISSUE };

function idOfPath(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

interface IssueAppProps {
  path: string;
  leaf: WorkspaceLeaf;
}

function IssueApp({ path, leaf }: IssueAppProps) {
  const plugin = usePlugin();
  const id = idOfPath(path);
  const issue = useIssue(id);
  const ready = useStoreReady();
  const settings = useSettings();
  const parentId = issue?.parent ? fromLink(issue.parent) : undefined;
  const parent = useIssue(parentId ?? "");
  const allIssues = useIssues();
  const children = useMemo(() => allIssues.filter((i) => i.parent !== undefined && fromLink(i.parent) === id), [allIssues, id]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [open, setOpen] = useState<{ kind: PropKind; anchor: HTMLElement | null } | null>(null);

  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);

  const update = useCallback(
    (patch: IssuePatch) => {
      void plugin.store.updateIssue(id, patch).catch((e) => {
        console.error("kyle-tickets: update failed", e);
        new Notice("Could not save the change.");
      });
    },
    [plugin, id],
  );

  const openPicker = useCallback((kind: PropKind, anchor: HTMLElement | null) => {
    setSidebarOpen(true);
    setOpen({ kind, anchor });
  }, []);
  const closePicker = useCallback(() => {
    setOpen(null);
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const onShortcut = useCallback(
    (action: ShortcutAction): boolean => {
      const kind: Partial<Record<ShortcutAction, PropKind>> = { status: "status", priority: "priority", labels: "labels", assignee: "assignee" };
      const k = kind[action];
      if (k) {
        setSidebarOpen(true);
        // Anchor after the sidebar is rendered.
        requestAnimationFrame(() => openPicker(k, rootRef.current?.querySelector<HTMLElement>(`[data-kt-prop="${k}"]`) ?? null));
        return true;
      }
      if (action === "new") {
        plugin.openNewIssue({ parent: id });
        return true;
      }
      if (action === "clear") {
        const hist = (leaf as unknown as { history?: { backHistory?: unknown[]; back(): void } }).history;
        if (hist?.backHistory && hist.backHistory.length > 0) hist.back();
        else void plugin.activateMainView();
        return true;
      }
      return false;
    },
    [leaf, plugin, openPicker, id],
  );
  useShortcuts(rootRef, onShortcut);

  if (!issue) {
    return (
      <div className="kt-issue kt-issue-state" ref={rootRef} tabIndex={-1}>
        {ready ? (
          <>
            <div>This issue was deleted</div>
            <button type="button" onClick={() => void plugin.activateMainView()}>
              Back to issues
            </button>
          </>
        ) : (
          <div>Loading...</div>
        )}
      </div>
    );
  }

  const file = plugin.app.vault.getAbstractFileByPath(path);
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(() => new Notice(`Copied ${what}`));
  };

  return (
    <div
      className="kt-issue"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <IssueHeader
        issue={issue}
        parent={parent}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenProject={(name) => {
          const f = plugin.app.metadataCache.getFirstLinkpathDest(name, path);
          if (f instanceof TFile) void plugin.app.workspace.getLeaf(false).openFile(f);
        }}
        onOpenIssue={(i) => plugin.openIssue(i)}
        onOpenMarkdown={() => void plugin.interceptor.showMarkdown(leaf)}
        onCopyId={() => copy(issue.id, issue.id)}
        onCopyLink={() => copy(`obsidian://open?vault=${encodeURIComponent(plugin.app.vault.getName())}&file=${encodeURIComponent(path)}`, "link")}
        onDelete={() => {
          void (async () => {
            if (!(file instanceof TFile)) return;
            const ok = await confirmModal(plugin.app, "Delete issue", `Delete ${issue.id} "${issue.title}"? The file is moved to trash.`, "Delete", true);
            if (ok) await plugin.store.deleteIssue(issue.id);
          })();
        }}
      />
      <div className="kt-issue-body">
        <div className="kt-issue-main">
          <div className="kt-issue-column">
            <TitleEditor title={issue.title} onSave={(title) => update({ title })} />
            <Description
              description={issue.description}
              sourcePath={path}
              onSave={(md) => {
                void plugin.store.updateDescription(id, md).catch((e) => {
                  console.error("kyle-tickets: description save failed", e);
                  new Notice("Could not save the description.");
                });
              }}
            />
            <SubIssues
              children={children}
              settings={settings}
              onOpen={(c, newTab) => plugin.openIssue(c.id, newTab)}
              onStatus={(c, status) => void plugin.store.updateIssue(c.id, { status })}
              onAdd={() => plugin.openNewIssue({ parent: id })}
            />
            <ActivityFeed feed={issue.feed} sourcePath={path} />
            <CommentBox
              onPost={(body) =>
                plugin.store.addComment(id, body).then(
                  () => undefined,
                  (e) => {
                    console.error("kyle-tickets: comment failed", e);
                    new Notice("Could not post the comment.");
                    throw e;
                  },
                )
              }
            />
          </div>
        </div>
        {sidebarOpen && <PropertiesSidebar issue={issue} settings={settings} open={open} onOpen={openPicker} onClose={closePicker} onUpdate={update} />}
      </div>
    </div>
  );
}

export class IssueView extends ItemView {
  private root: Root | null = null;
  private path = "";
  private unsub: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: KyleTicketsPlugin) {
    super(leaf);
    this.navigation = true;
  }

  override getViewType(): string {
    return VIEW_TYPE_ISSUE;
  }

  override getDisplayText(): string {
    const id = idOfPath(this.path);
    const issue = this.plugin.store.getIssue(id);
    return issue ? `${id} ${issue.title}` : id || "Issue";
  }

  override getIcon(): string {
    return "circle-dot";
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
    this.contentEl.addClass("kt-root");
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
          <IssueApp key={this.path} path={this.path} leaf={this.leaf} />
        </PluginContext.Provider>
      </StrictMode>,
    );
  }
}
