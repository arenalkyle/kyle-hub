import { Notice } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hiddenFor, toggleHidden, visibleGroups } from "../../core/hidden";
import { applyPatch, type IssuePatch } from "../../core/issueFile";
import { buildView, OTHER_GROUP_KEY } from "../../core/query";
import { useIssues, useProjects, useSettings } from "../../store/hooks";
import { usePlugin } from "../PluginContext";
import { AssigneePicker } from "../components/pickers/AssigneePicker";
import { LabelPicker } from "../components/pickers/LabelPicker";
import { PriorityPicker } from "../components/pickers/PriorityPicker";
import { StatusPicker } from "../components/pickers/StatusPicker";
import { moveSelection, useShortcuts, type ShortcutAction } from "../shortcuts";
import { BoardView, type BoardMove } from "./BoardView";
import { FilterBar } from "./FilterBar";
import { Header } from "./Header";
import { flatten, ListView } from "./ListView";
import { useViewState } from "./useViewState";

export interface IssueCollectionProps {
  /** Fixed `selectView` scope (`all`, `active`, `backlog`, `project:<name>`). */
  scope: string;
  /** Key under which display/filter/collapse state is saved. */
  viewKey: string;
  title: string;
  /** Project name when the scope is one project (New issue preset). */
  project?: string;
  /** Embedded in a page: no focus grab on mount. */
  embedded?: boolean;
  /** Sidebar toggle in the header; omitted when there is no sidebar to toggle. */
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  /** Hosts that need to change filters (e.g. milestone click) share one view state instance. */
  viewState?: ReturnType<typeof useViewState>;
  notice?: ReactNode;
}

/** Header + Display/Filter + List/Board for a fixed scope; shared by the main view and project pages. */
export function IssueCollection({ scope, viewKey, title, project, embedded, sidebarCollapsed = false, onToggleSidebar, viewState, notice }: IssueCollectionProps) {
  const plugin = usePlugin();
  const storeIssues = useIssues();
  const projects = useProjects();
  const settings = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterSignal, setFilterSignal] = useState(0);
  const [sp, setSp] = useState<{ kind: "status" | "priority" | "labels" | "assignee"; id: string; anchor: HTMLElement | null } | null>(null);
  const [, setCollapseTick] = useState(0);

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

  const own = useViewState(viewKey);
  const { display, setDisplay, filters, setFilters, reset } = viewState ?? own;
  const built = useMemo(() => {
    // Linear shows every workflow column on a status board, even empty ones.
    const boardStatus = display.layout === "board" && display.groupBy === "status";
    const d = boardStatus ? { ...display, showEmptyGroups: true } : display;
    const b = buildView(issues, scope, projects, settings, d, filters, new Date());
    if (!boardStatus || display.showEmptyGroups) return b;
    return { ...b, groups: b.groups.filter((g) => g.key !== OTHER_GROUP_KEY || g.issues.length > 0) };
  }, [issues, scope, projects, settings, display, filters]);
  const allGroups = built.groups;
  const visible = useMemo(() => visibleGroups(allGroups, hiddenFor(display.hiddenGroups, display.groupBy)), [allGroups, display.hiddenGroups, display.groupBy]);
  const collapsedList = plugin.data.main.collapsedGroups[viewKey];
  const collapsed = useMemo(() => new Set(collapsedList ?? []), [collapsedList]);

  const toggleGroup = (key: string) => {
    const set = new Set(collapsed);
    if (!set.delete(key)) set.add(key);
    plugin.data.main.collapsedGroups = { ...plugin.data.main.collapsedGroups, [viewKey]: [...set] };
    setCollapseTick((n) => n + 1);
    void plugin.savePluginData();
  };
  const hideGroup = (key: string) => setDisplay({ ...display, hiddenGroups: toggleHidden(display.hiddenGroups, display.groupBy, key, true) });
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

  useEffect(() => {
    if (!embedded) rootRef.current?.focus({ preventScroll: true });
  }, [embedded]);
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
      className="kt-collection"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (!t.closest("input, textarea, select, [contenteditable]")) rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <Header
        title={title}
        count={built.total}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        onNewIssue={newIssue}
        display={display}
        onDisplayChange={setDisplay}
        onDisplayReset={reset}
        filters={filters}
        onFiltersChange={setFilters}
        filterSignal={filterSignal}
        groups={allGroups}
      />
      <FilterBar filters={filters} onChange={setFilters} />
      {notice}
      {visible.length === 0 && !display.showEmptyGroups ? (
        <div className="kt-empty">
          <div>No issues</div>
          <button type="button" className="mod-cta" onClick={newIssue}>
            New issue
          </button>
        </div>
      ) : display.layout === "board" ? (
        <BoardView groups={visible} display={display} subCounts={built.subCounts} issues={issues} project={project} selectedId={current} collapsed={collapsed} onToggleGroup={toggleGroup} onHideGroup={hideGroup} onMove={onMove} />
      ) : (
        <ListView groups={visible} display={display} subCounts={built.subCounts} issues={issues} viewId={viewKey} project={project} selectedId={current} collapsed={collapsed} onToggleGroup={toggleGroup} />
      )}
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
