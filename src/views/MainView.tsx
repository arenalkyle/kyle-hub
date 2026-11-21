import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type KyleTicketsPlugin from "../main";
import type { MainUiState } from "../data";
import { applyPatch, type IssuePatch } from "../core/issueFile";
import { buildView, OTHER_GROUP_KEY, viewTitle } from "../core/query";
import { useIssues, useProjects, useSettings } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { AssigneePicker } from "./components/pickers/AssigneePicker";
import { LabelPicker } from "./components/pickers/LabelPicker";
import { PriorityPicker } from "./components/pickers/PriorityPicker";
import { StatusPicker } from "./components/pickers/StatusPicker";
import { moveSelection, useShortcuts, type ShortcutAction } from "./shortcuts";
import { BoardView, type BoardMove } from "./main/BoardView";
import { FilterBar } from "./main/FilterBar";
import { Header } from "./main/Header";
import { flatten, ListView } from "./main/ListView";
import { Sidebar } from "./main/Sidebar";
import { useViewState } from "./main/useViewState";

export const VIEW_TYPE_MAIN = "kyle-tickets-main";

function MainApp() {
  const plugin = usePlugin();
  const storeIssues = useIssues();
  const projects = useProjects();
  const settings = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterSignal, setFilterSignal] = useState(0);
  const [sp, setSp] = useState<{ kind: "status" | "priority" | "labels" | "assignee"; id: string; anchor: HTMLElement | null } | null>(null);
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

  // Board moves show immediately; each entry is dropped once its write settles (the store has emitted by then).
  const [optimistic, setOptimistic] = useState<Record<string, IssuePatch>>({});
  const issues = useMemo(() => {
    if (Object.keys(optimistic).length === 0) return storeIssues;
    const now = new Date();
    return storeIssues.map((i) => (optimistic[i.id] ? applyPatch(i, optimistic[i.id]!, now) : i));
  }, [storeIssues, optimistic]);

  const onMove = useCallback(
    (moves: BoardMove[]) => {
      const pending = Object.fromEntries(moves.map((m) => [m.id, m.patch]));
      setOptimistic((o) => ({ ...o, ...pending }));
      void (async () => {
        try {
          for (const m of moves) await plugin.store.updateIssue(m.id, m.patch);
        } catch (e) {
          console.error("kyle-tickets: board move failed", e);
          new Notice("Could not move the card; the change was reverted.");
        } finally {
          setOptimistic((o) => {
            const next = { ...o };
            for (const [id, p] of Object.entries(pending)) if (next[id] === p) delete next[id];
            return next;
          });
        }
      })();
    },
    [plugin],
  );

  const view = ui.view;
  const { display, setDisplay, filters, setFilters, reset } = useViewState(view);
  const built = useMemo(() => {
    // Linear shows every workflow column on a status board, even empty ones.
    const boardStatus = display.layout === "board" && display.groupBy === "status";
    const d = boardStatus ? { ...display, showEmptyGroups: true } : display;
    const b = buildView(issues, view, projects, settings, d, filters, new Date());
    if (!boardStatus || display.showEmptyGroups) return b;
    return { ...b, groups: b.groups.filter((g) => g.key !== OTHER_GROUP_KEY || g.issues.length > 0) };
  }, [issues, view, projects, settings, display, filters]);
  const visible = built.groups;
  const collapsed = useMemo(() => new Set(ui.collapsedGroups[view] ?? []), [ui.collapsedGroups, view]);
  const project = view.startsWith("project:") ? view.slice("project:".length) : undefined;

  const toggleGroup = (key: string) => {
    const set = new Set(collapsed);
    if (!set.delete(key)) set.add(key);
    commit({ ...ui, collapsedGroups: { ...ui.collapsedGroups, [view]: [...set] } });
  };
  const newIssue = () => plugin.openNewIssue({ project });

  // Keyboard navigation order: the rows (List) or cards (Board) currently shown, top to bottom.
  const navIds = useMemo(() => {
    if (display.layout === "list") {
      return flatten(visible, collapsed).flatMap((it) => (it.kind === "row" ? [it.issue.id] : []));
    }
    return visible.flatMap((g) =>
      g.subgroups
        ? g.subgroups.filter((sg) => !collapsed.has(`lane:${sg.key.slice(g.key.length + 1)}`)).flatMap((sg) => sg.issues.map((i) => i.id))
        : g.issues.map((i) => i.id),
    );
  }, [display.layout, visible, collapsed]);
  const current = selectedId !== null && navIds.includes(selectedId) ? selectedId : null;

  useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (current === null || display.layout !== "board") return;
    rootRef.current?.querySelector(`[data-kt-id="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, display.layout]);

  const onShortcut = useCallback(
    (action: ShortcutAction): boolean => {
      switch (action) {
        case "next":
        case "prev":
          setSelectedId(moveSelection(navIds, current, action === "next" ? 1 : -1));
          return true;
        case "clear":
          if (current === null) return false;
          setSelectedId(null);
          return true;
        case "open":
          if (current === null) return false;
          plugin.openIssue(current);
          return true;
        case "new":
          plugin.openNewIssue({ project });
          return true;
        case "toggleLayout":
          setDisplay({ ...display, layout: display.layout === "board" ? "list" : "board" });
          return true;
        case "filter":
          setFilterSignal((n) => n + 1);
          return true;
        default: {
          if (current === null) return false;
          const root = rootRef.current;
          const anchor =
            root?.querySelector<HTMLElement>(`[data-kt-id="${CSS.escape(current)}"]`) ??
            root?.querySelector<HTMLElement>(".kt-header") ??
            null;
          setSp({ kind: action, id: current, anchor });
          return true;
        }
      }
    },
    [navIds, current, plugin, project, display, setDisplay],
  );
  useShortcuts(rootRef, onShortcut);

  const closeSp = useCallback(() => {
    setSp(null);
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  const spIssue = sp ? issues.find((i) => i.id === sp.id) : undefined;
  const spUpdate = (patch: IssuePatch) => {
    if (sp) void plugin.store.updateIssue(sp.id, patch).catch((e) => console.error("kyle-tickets: update failed", e));
  };

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
          filters={filters}
          onFiltersChange={setFilters}
          filterSignal={filterSignal}
        />
        <FilterBar filters={filters} onChange={setFilters} />
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
        ) : display.layout === "board" ? (
          <BoardView groups={built.groups} display={display} subCounts={built.subCounts} issues={issues} project={project} selectedId={current} collapsed={collapsed} onToggleGroup={toggleGroup} onMove={onMove} />
        ) : (
          <ListView groups={built.groups} display={display} subCounts={built.subCounts} issues={issues} viewId={view} project={project} selectedId={current} collapsed={collapsed} onToggleGroup={toggleGroup} />
        )}
      </div>
      {sp && spIssue && sp.kind === "status" && (
        <StatusPicker anchor={sp.anchor} value={spIssue.status} onChange={(status) => spUpdate({ status })} onClose={closeSp} />
      )}
      {sp && spIssue && sp.kind === "priority" && (
        <PriorityPicker anchor={sp.anchor} value={spIssue.priority} onChange={(priority) => spUpdate({ priority })} onClose={closeSp} />
      )}
      {sp && spIssue && sp.kind === "labels" && (
        <LabelPicker anchor={sp.anchor} value={spIssue.tags} onChange={(tags) => spUpdate({ tags })} onClose={closeSp} />
      )}
      {sp && spIssue && sp.kind === "assignee" && (
        <AssigneePicker anchor={sp.anchor} value={spIssue.assignee} onChange={(a) => spUpdate({ assignee: a ?? null })} onClose={closeSp} />
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
