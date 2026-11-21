import { useMemo } from "react";
import { useProjects } from "../../../store/hooks";
import { Picker } from "../Picker";
import { Icon } from "../icons";

interface Item {
  name: string | null;
  color?: string;
}

export interface ProjectPickerProps {
  anchor: HTMLElement | null;
  value: string | undefined;
  onChange: (project: string | undefined) => void;
  onClose: () => void;
}

export function ProjectPicker({ anchor, value, onChange, onClose }: ProjectPickerProps) {
  const projects = useProjects();
  const items = useMemo<Item[]>(
    () => [
      { name: null },
      ...[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ name: p.name, color: p.color })),
    ],
    [projects],
  );
  return (
    <Picker<Item>
      anchor={anchor}
      items={items}
      getKey={(i) => i.name ?? "__none"}
      getSearch={(i) => [i.name ?? "No project"]}
      selectedKeys={[value ?? "__none"]}
      placeholder="Set project..."
      renderItem={(i) => (
        <>
          <span style={i.color ? { color: i.color } : undefined} className="kh-tickets-picker-icon">
            <Icon name="box" />
          </span>
          <span className="kh-tickets-picker-label">{i.name ?? "No project"}</span>
        </>
      )}
      onSelect={(i) => onChange(i.name ?? undefined)}
      onClose={onClose}
    />
  );
}
