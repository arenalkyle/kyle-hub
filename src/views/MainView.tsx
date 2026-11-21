import { ItemView, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import type { MainUiState } from "../data";
import { buildView, viewTitle } from "../core/query";
import { useIssues, useProjects } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { Header } from "./main/Header";
import { ListView } from "./main/ListView";
import { Sidebar } from "./main/Sidebar";
import { useViewState } from "./main/useViewState";

export const VIEW_TYPE_MAIN = "kyle-tickets-main";

function MainApp() {
  const plugin = usePlugin();
  const issues = useIssues();
  const projects = useProjects();
  const { settings } = plugin.data;
  const [ui, setUi] = useState<MainUiState>(() => ({ ...plugin.data.main }));
  const [width, setWidth] = useState(ui.sidebarWidth);

  const commit = useCallback(
    (next: MainUiState) => {
      plugin.data.main = next;
      setUi(next);
      void plugin.savePluginData();
    },
    [plugin],
  );

  const view = ui.view;
  const { display, setDisplay, reset } = useViewState(view);
  const built = useMemo(
    () => buildView(issues, view, projects, settings, display, undefined, new Date()),
    [issues, view, projects, settings, display],
  );
  const visible = built.groups;
  const collapsed = useMemo(() => new Set(ui.collapsedGroups[view] ?? []), [ui.collapsedGroups, view]);
  const project = view.startsWith("project:") ? view.slice("project:".length) : undefined;

  const toggleGroup = (key: string) => {
    const set = new Set(collapsed);
    if (!set.delete(key)) set.add(key);
    commit({ ...ui, collapsedGroups: { ...ui.collapsedGroups, [view]: [...set] } });
  };
  const newIssue = () => plugin.openNewIssue({ project });

  return (
    <div className="kt-main">
      {!ui.sidebarCollapsed && (
        <Sidebar
          view={view}
          projects={projects}
          width={width}
          onSelect={(v) => commit({ ...ui, view: v })}
          onResize={(w, done) => {
            setWidth(w);
            if (done) commit({ ...ui, sidebarWidth: w });
          }}
        />
      )}
      <div className="kt-content">
        <Header
          title={viewTitle(view)}
          count={built.total}
          sidebarCollapsed={ui.sidebarCollapsed}
          onToggleSidebar={() => commit({ ...ui, sidebarCollapsed: !ui.sidebarCollapsed })}
          onNewIssue={newIssue}
          display={display}
          onDisplayChange={setDisplay}
          onDisplayReset={reset}
        />
        {!plugin.data.setupDone && (
          <div className="kt-notice">kyle-tickets setup has not run yet. Finish the setup window or open the plugin settings.</div>
        )}
        {visible.length === 0 && !display.showEmptyGroups ? (
          <div className="kt-empty">
            <div>No issues</div>
            <button type="button" className="mod-cta" onClick={newIssue}>
              New issue
            </button>
          </div>
        ) : (
          <ListView groups={built.groups} display={display} subCounts={built.subCounts} issues={issues} viewId={view} project={project} collapsed={collapsed} onToggleGroup={toggleGroup} />
        )}
      </div>
    </div>
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
