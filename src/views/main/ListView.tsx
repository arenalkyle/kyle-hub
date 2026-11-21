import { TFile } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupIssues, type Group } from "../../core/query";
import type { Issue, Priority } from "../../core/types";
import { Icon, StatusIcon } from "../components/icons";
import { PriorityPicker } from "../components/pickers/PriorityPicker";
import { StatusPicker } from "../components/pickers/StatusPicker";
import { usePlugin } from "../PluginContext";
import { IssueRow } from "./IssueRow";

export const ITEM_HEIGHT = 36;
const OVERSCAN = 12;

type Item = { kind: "header"; group: Group; collapsed: boolean } | { kind: "row"; issue: Issue };

/** Flattens groups into one fixed-height list so it can be windowed. */
export function flatten(groups: Group[], collapsed: ReadonlySet<string>): Item[] {
  const out: Item[] = [];
  for (const g of groups) {
    const c = collapsed.has(g.key);
    out.push({ kind: "header", group: g, collapsed: c });
    if (!c) for (const issue of g.issues) out.push({ kind: "row", issue });
  }
  return out;
}

export interface ListViewProps {
  issues: Issue[];
  viewId: string;
  project?: string;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
}

export function ListView({ issues, viewId, project, collapsed, onToggleGroup }: ListViewProps) {
  const plugin = usePlugin();
  const { settings } = plugin.data;
  const groups = useMemo(() => groupIssues(issues, "status", settings), [issues, settings]);
  const items = useMemo(() => flatten(groups, collapsed), [groups, collapsed]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [picker, setPicker] = useState<{ kind: "status" | "priority"; id: string; anchor: HTMLElement } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setPicker(null), [viewId]);

  const open = useCallback(
    (issue: Issue, newTab: boolean) => {
      const path = plugin.store.pathOf(issue.id);
      const f = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
      if (f instanceof TFile) void plugin.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
    },
    [plugin],
  );
  const onStatus = useCallback((i: Issue, anchor: HTMLElement) => setPicker({ kind: "status", id: i.id, anchor }), []);
  const onPriority = useCallback((i: Issue, anchor: HTMLElement) => setPicker({ kind: "priority", id: i.id, anchor }), []);
  const closePicker = useCallback(() => setPicker(null), []);

  const update = (id: string, patch: { status?: string; priority?: Priority }) =>
    void plugin.store.updateIssue(id, patch).catch((e) => console.error("kyle-tickets: update failed", e));

  const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / ITEM_HEIGHT) + OVERSCAN);
  const pickedIssue = picker ? issues.find((i) => i.id === picker.id) : undefined;

  return (
    <div className="kt-list" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="kt-list-spacer" style={{ height: items.length * ITEM_HEIGHT }}>
        {items.slice(start, end).map((item, n) => {
          const style = { top: (start + n) * ITEM_HEIGHT, height: ITEM_HEIGHT };
          if (item.kind === "row") {
            return (
              <div key={item.issue.id} className="kt-item" style={style}>
                <IssueRow issue={item.issue} settings={settings} onOpen={open} onStatus={onStatus} onPriority={onPriority} />
              </div>
            );
          }
          const g = item.group;
          return (
            <div key={`h:${g.key}`} className="kt-item" style={style}>
              <div className="kt-group-header" onClick={() => onToggleGroup(g.key)}>
                <span className={`kt-chevron${item.collapsed ? " is-collapsed" : ""}`}>
                  <Icon name="chevron-down" size={14} />
                </span>
                {g.status ? <StatusIcon category={g.status.category} color={g.status.color} /> : null}
                <span className="kt-group-name">{g.label}</span>
                <span className="kt-group-count">{g.issues.length}</span>
                <button
                  type="button"
                  className="kt-group-add"
                  title={`New issue in ${g.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    plugin.openNewIssue({ status: g.status?.name, project });
                  }}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {picker?.kind === "status" && pickedIssue && (
        <StatusPicker
          anchor={picker.anchor}
          value={pickedIssue.status}
          onChange={(status) => update(pickedIssue.id, { status })}
          onClose={closePicker}
        />
      )}
      {picker?.kind === "priority" && pickedIssue && (
        <PriorityPicker
          anchor={picker.anchor}
          value={pickedIssue.priority}
          onChange={(priority) => update(pickedIssue.id, { priority })}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
