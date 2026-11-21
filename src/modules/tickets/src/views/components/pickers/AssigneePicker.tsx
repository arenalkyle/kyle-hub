import { useMemo } from "react";
import { useIssues } from "../../../store/hooks";
import { usePlugin } from "../../PluginContext";
import { Picker } from "../Picker";
import { Icon } from "../icons";

interface Item {
  name: string | null;
}

export interface AssigneePickerProps {
  anchor: HTMLElement | null;
  value: string | undefined;
  onChange: (assignee: string | undefined) => void;
  onClose: () => void;
}

export function AssigneePicker({ anchor, value, onChange, onClose }: AssigneePickerProps) {
  const { data } = usePlugin();
  const issues = useIssues();
  const items = useMemo<Item[]>(() => {
    // Recents: assignees of existing issues, most recently updated first.
    const seen = new Set<string>();
    const names: string[] = [];
    const add = (n: string | undefined) => {
      const t = n?.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        names.push(t);
      }
    };
    add(data.settings.displayName);
    [...issues].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "")).forEach((i) => add(i.assignee));
    add(value);
    return [{ name: null }, ...names.map((name) => ({ name }))];
  }, [issues, data.settings.displayName, value]);

  return (
    <Picker<Item>
      anchor={anchor}
      items={items}
      getKey={(i) => i.name ?? "__none"}
      getSearch={(i) => [i.name ?? "No assignee"]}
      selectedKeys={[value ?? "__none"]}
      placeholder="Assign to..."
      renderItem={(i) => (
        <>
          <Icon name="user" />
          <span className="kh-tickets-picker-label">{i.name ?? "No assignee"}</span>
        </>
      )}
      create={{ label: (q) => `Assign to "${q}"`, onCreate: (q) => onChange(q) }}
      onSelect={(i) => onChange(i.name ?? undefined)}
      onClose={onClose}
    />
  );
}
