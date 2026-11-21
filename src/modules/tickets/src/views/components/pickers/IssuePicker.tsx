import { useMemo } from "react";
import type { Issue } from "../../../core/types";
import { useIssues } from "../../../store/hooks";
import { usePlugin } from "../../PluginContext";
import { Picker } from "../Picker";
import { StatusIcon } from "../icons";

interface Item {
  issue: Issue | null;
}

export interface IssuePickerProps {
  anchor: HTMLElement | null;
  value: string | undefined;
  /** Issue id to leave out (the issue being edited). */
  excludeId?: string;
  placeholder?: string;
  onChange: (id: string | undefined) => void;
  onClose: () => void;
}

export function IssuePicker({ anchor, value, excludeId, placeholder, onChange, onClose }: IssuePickerProps) {
  const { data } = usePlugin();
  const issues = useIssues();
  const items = useMemo<Item[]>(
    () => [
      { issue: null },
      ...[...issues]
        .filter((i) => i.id !== excludeId)
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
        .map((issue) => ({ issue })),
    ],
    [issues, excludeId],
  );
  const statusOf = (name: string) => data.settings.statuses.find((s) => s.name === name);
  return (
    <Picker<Item>
      anchor={anchor}
      items={items}
      getKey={(i) => i.issue?.id ?? "__none"}
      getSearch={(i) => (i.issue ? [i.issue.id, i.issue.title] : ["No parent"])}
      selectedKeys={[value ?? "__none"]}
      placeholder={placeholder ?? "Search by ID or title..."}
      renderItem={(i) => {
        if (!i.issue) return <span className="kt-picker-label">No parent</span>;
        const st = statusOf(i.issue.status);
        return (
          <>
            <StatusIcon category={st?.category ?? "backlog"} color={st?.color} />
            <span className="kt-picker-id">{i.issue.id}</span>
            <span className="kt-picker-label">{i.issue.title}</span>
          </>
        );
      }}
      onSelect={(i) => onChange(i.issue?.id)}
      onClose={onClose}
    />
  );
}
