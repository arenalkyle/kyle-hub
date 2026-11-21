import { ItemView, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import type { MainUiState } from "../data";
import { projectViewId, viewTitle } from "../../../../core/domain/query";
import { useProjects } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { ProjectPage } from "./project/ProjectPage";
import { Icon } from "./components/icons";
import { TriageView } from "./main/TriageView";
import { IssueCollection } from "./main/IssueCollection";
import { Sidebar } from "./main/Sidebar";

export const VIEW_TYPE_MAIN = "kh-tickets-main";

function MainApp() {
  const plugin = usePlugin();
  const projects = useProjects();
  const rootRef = useRef<HTMLDivElement>(null);
  const [ui, setUi] = useState<MainUiState>(() => ({ ...plugin.data.main }));
  const [width, setWidth] = useState(ui.sidebarWidth);

  const commit = useCallback(
    (next: MainUiState) => {
      // Collapsed groups are owned by IssueCollection; keep its latest value.
      const merged = { ...next, collapsedGroups: plugin.data.main.collapsedGroups };
      plugin.data.main = merged;
      setUi(merged);
      void plugin.savePluginData();
    },
    [plugin],
  );

  const view = ui.view;
  const project = view.startsWith("project:") ? view.slice("project:".length) : undefined;
  const showPage = project !== undefined;

  return (
    <div
      className="kh-tickets-main"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, select, [contenteditable]")) rootRef.current?.focus({ preventScroll: true });
      }}
    >
      {!ui.sidebarCollapsed && (
        <Sidebar
          view={view}
          projects={projects}
          width={width}
          onNewProject={() => plugin.openNewProject()}
          onSelect={(v) => {
            commit({ ...ui, view: v });
          }}
          onResize={(w, done) => {
            setWidth(w);
            if (done) commit({ ...ui, sidebarWidth: w });
          }}
        />
      )}
      {showPage ? (
        <div className="kh-tickets-content">
          <ProjectPage
            key={project}
            name={project!}
            headerLeft={
              ui.sidebarCollapsed ? (
                <button type="button" className="clickable-icon" title="Show sidebar" aria-label="Show sidebar" onClick={() => commit({ ...ui, sidebarCollapsed: false })}>
                  <Icon name="panel-left" size={16} />
                </button>
              ) : undefined
            }
            onRenamed={(n) => {
              commit({ ...plugin.data.main, view: projectViewId(n) });
            }}
            onDeleted={() => commit({ ...plugin.data.main, view: "all" })}
          />
        </div>
      ) : view === "triage" ? (
        <div className="kh-tickets-content">
          <TriageView sidebarCollapsed={ui.sidebarCollapsed} onToggleSidebar={() => commit({ ...ui, sidebarCollapsed: !ui.sidebarCollapsed })} />
        </div>
      ) : (
      <div className="kh-tickets-content">
        <IssueCollection
          scope={view}
          viewKey={view}
          title={viewTitle(view)}
          project={project}
          sidebarCollapsed={ui.sidebarCollapsed}
          onToggleSidebar={() => commit({ ...ui, sidebarCollapsed: !ui.sidebarCollapsed })}
          notice={
            !plugin.data.setupDone ? (
              <div className="kh-tickets-notice">kyle-tickets setup has not run yet. Finish the setup window or open the plugin settings.</div>
            ) : undefined
          }
        />
      </div>
      )}
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
    this.contentEl.addClass("kh-tickets-root");
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
