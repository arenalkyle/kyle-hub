import { useMemo } from "react";
import { PRIORITY_LABELS, PRIORITY_ORDER } from "../../core/defaults";
import {
  DUE_LABELS, DUE_VALUES, FILTER_FIELDS, FILTER_FIELD_LABELS, NONE_VALUE, type FilterField,
} from "../../core/filters";
import { fromLink } from "../../core/links";
import { useIssues, useProjects } from "../../store/hooks";
import { usePlugin } from "../PluginContext";
import { Picker } from "../components/Picker";
import { Dot, Icon, PriorityIcon, StatusIcon } from "../components/icons";

interface Item {
  key: string;
  label: string;
  node?: React.ReactNode;
}

export function FieldPicker({ anchor, onSelect, onClose }: { anchor: HTMLElement | null; onSelect: (f: FilterField) => void; onClose: () => void }) {
  return (
    <Picker<FilterField>
      anchor={anchor}
      items={FILTER_FIELDS}
      getKey={(f) => f}
      getSearch={(f) => [FILTER_FIELD_LABELS[f]]}
      placeholder="Filter by..."
      renderItem={(f) => <span className="kt-picker-label">{FILTER_FIELD_LABELS[f]}</span>}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

/** Multi-select value picker for one filter field (built on the shared Picker). */
export function ValuePicker({
  anchor, field, value, onChange, onClose,
}: {
  anchor: HTMLElement | null;
  field: FilterField;
  value: readonly string[];
  onChange: (values: string[]) => void;
  onClose: () => void;
}) {
  const { data } = usePlugin();
  const issues = useIssues();
  const projects = useProjects();
  const colors = data.settings.labelColors;

  const items = useMemo<Item[]>(() => {
    const none = (label: string): Item => ({ key: NONE_VALUE, label });
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
    switch (field) {
      case "status":
        return [...data.settings.statuses].sort((a, b) => a.order - b.order).map((s) => ({
          key: s.name, label: s.name, node: <StatusIcon category={s.category} color={s.color} />,
        }));
      case "priority":
        return PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_LABELS[p], node: <PriorityIcon priority={p} /> }));
      case "project":
        return [none("No project"), ...uniq(projects.map((p) => p.name)).map((n) => ({ key: n, label: n, node: <Icon name="box" size={14} /> }))];
      case "milestone":
        return [none("No milestone"), ...uniq(projects.flatMap((p) => p.milestones.map((m) => m.name))).map((n) => ({ key: n, label: n }))];
      case "assignee":
        return [none("No assignee"), ...uniq(issues.flatMap((i) => (i.assignee?.trim() ? [i.assignee.trim()] : []))).map((n) => ({ key: n, label: n }))];
      case "label":
        return [none("No label"), ...uniq([...Object.keys(colors), ...issues.flatMap((i) => i.tags)]).map((n) => ({
          key: n, label: n, node: <Dot color={colors[n] ?? "var(--text-faint)"} />,
        }))];
      case "due":
        return DUE_VALUES.map((v) => ({ key: v, label: DUE_LABELS[v] }));
    }
  }, [field, data.settings.statuses, projects, issues, colors]);

  const toggle = (it: Item) => onChange(value.includes(it.key) ? value.filter((v) => v !== it.key) : [...value, it.key]);
  return (
    <Picker<Item>
      anchor={anchor}
      items={items}
      multi
      getKey={(i) => i.key}
      getSearch={(i) => [i.label]}
      selectedKeys={value}
      placeholder={`Filter ${FILTER_FIELD_LABELS[field].toLowerCase()}...`}
      renderItem={(i) => (
        <>
          {i.node}
          <span className="kt-picker-label">{i.label}</span>
        </>
      )}
      onSelect={toggle}
      onClose={onClose}
    />
  );
}

/** Human label for a stored filter value. */
export function valueLabel(field: FilterField, v: string): string {
  if (v === NONE_VALUE) return `No ${field === "due" ? "due date" : field}`;
  if (field === "priority") return PRIORITY_LABELS[v as keyof typeof PRIORITY_LABELS] ?? v;
  if (field === "due") return DUE_LABELS[v as keyof typeof DUE_LABELS] ?? v;
  return field === "project" || field === "milestone" ? fromLink(v) : v;
}

