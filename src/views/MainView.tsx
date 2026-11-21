import { ItemView, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import type { MainUiState } from "../data";
import { projectViewId, viewTitle } from "../core/query";
import { useProjects } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { ProjectPage } from "./project/ProjectPage";
import { Icon } from "./components/icons";
import { IssueCollection } from "./main/IssueCollection";
import { Sidebar } from "./main/Sidebar";

export const VIEW_TYPE_MAIN = "kyle-tickets-main";

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
  // The project page is the default for a project; "View issues" shows its issue list until another view is picked.
  const [issuesOf, setIssuesOf] = useState<string | null>(null);
  const showPage = project !== undefined && issuesOf !== view;

  return (
    <div
      className="kt-main"
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
            setIssuesOf(null);
            commit({ ...ui, view: v });
          }}
          onResize={(w, done) => {
            setWidth(w);
            if (done) commit({ ...ui, sidebarWidth: w });
          }}
        />
      )}
      {showPage ? (
        <div className="kt-content">
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
            onViewIssues={() => setIssuesOf(view)}
            onRenamed={(n) => {
              if (issuesOf !== null) setIssuesOf(projectViewId(n));
              commit({ ...plugin.data.main, view: projectViewId(n) });
            }}
            onDeleted={() => commit({ ...plugin.data.main, view: "all" })}
          />
        </div>
      ) : (
      <div className="kt-content">
        {project !== undefined && (
          <div className="kt-project-back">
            <button type="button" className="clickable-icon" onClick={() => setIssuesOf(null)}>
              <Icon name="arrow-left" size={14} /> Project page
            </button>
          </div>
        )}
        <IssueCollection
          scope={view}
          viewKey={view}
          title={viewTitle(view)}
          project={project}
          sidebarCollapsed={ui.sidebarCollapsed}
          onToggleSidebar={() => commit({ ...ui, sidebarCollapsed: !ui.sidebarCollapsed })}
          notice={
            !plugin.data.setupDone ? (
              <div className="kt-notice">kyle-tickets setup has not run yet. Finish the setup window or open the plugin settings.</div>
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
