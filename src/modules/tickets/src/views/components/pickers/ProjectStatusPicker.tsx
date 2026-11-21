import type { ProjectStatus } from "../../../../../../core/domain/types";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "../../../../../../core/domain/projects";
import { Picker } from "../Picker";
import { ProjectStatusIcon } from "../icons";

export interface ProjectStatusPickerProps {
  anchor: HTMLElement | null;
  value: ProjectStatus;
  onChange: (status: ProjectStatus) => void;
  onClose: () => void;
}

export function ProjectStatusPicker({ anchor, value, onChange, onClose }: ProjectStatusPickerProps) {
  return (
    <Picker<ProjectStatus>
      anchor={anchor}
      items={PROJECT_STATUSES}
      getKey={(s) => s}
      getSearch={(s) => [PROJECT_STATUS_LABELS[s]]}
      selectedKeys={[value]}
      placeholder="Set project status..."
      renderItem={(s) => (
        <>
          <ProjectStatusIcon status={s} />
          <span className="kh-tickets-picker-label">{PROJECT_STATUS_LABELS[s]}</span>
        </>
      )}
      onSelect={onChange}
      onClose={onClose}
    />
  );
}
