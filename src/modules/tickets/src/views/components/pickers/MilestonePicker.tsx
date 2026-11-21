import { useMemo } from "react";
import { fromLink } from "../../../../../../core/domain/links";
import { useProjects } from "../../../store/hooks";
import { Picker } from "../Picker";
import { Icon } from "../icons";

interface Item {
  name: string | null;
  target?: string;
}

export interface MilestonePickerProps {
  anchor: HTMLElement | null;
  /** Project name or `[[link]]` whose milestones are offered. */
  project: string | undefined;
  value: string | undefined;
  onChange: (milestone: string | undefined) => void;
  onClose: () => void;
}

export function MilestonePicker({ anchor, project, value, onChange, onClose }: MilestonePickerProps) {
  const projects = useProjects();
  const items = useMemo<Item[]>(() => {
    const name = project ? fromLink(project) : undefined;
    const p = projects.find((x) => x.name === name);
    return [{ name: null }, ...(p?.milestones ?? []).map((m) => ({ name: m.name, target: m.target }))];
  }, [projects, project]);
  return (
    <Picker<Item>
      anchor={anchor}
      items={items}
      getKey={(i) => i.name ?? "__none"}
      getSearch={(i) => [i.name ?? "No milestone"]}
      selectedKeys={[value ?? "__none"]}
      placeholder="Set milestone..."
      renderItem={(i) => (
        <>
          <Icon name="milestone" />
          <span className="kh-tickets-picker-label">{i.name ?? "No milestone"}</span>
          {i.target && <span className="kh-tickets-picker-meta">{i.target}</span>}
        </>
      )}
      onSelect={(i) => onChange(i.name ?? undefined)}
      onClose={onClose}
    />
  );
}
