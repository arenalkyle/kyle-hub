import type { Priority } from "../../../../../../core/domain/types";
import { PRIORITY_LABELS } from "../../../../../../core/domain/defaults";
import { Picker } from "../Picker";
import { PriorityIcon } from "../icons";

const ORDER: Priority[] = ["none", "urgent", "high", "medium", "low"];

export interface PriorityPickerProps {
  anchor: HTMLElement | null;
  value: Priority;
  onChange: (p: Priority) => void;
  onClose: () => void;
}

export function PriorityPicker({ anchor, value, onChange, onClose }: PriorityPickerProps) {
  return (
    <Picker<Priority>
      anchor={anchor}
      items={ORDER}
      getKey={(p) => p}
      getSearch={(p) => [PRIORITY_LABELS[p]]}
      selectedKeys={[value]}
      searchable={false}
      renderItem={(p) => (
        <>
          <PriorityIcon priority={p} />
          <span className="kt-picker-label">{PRIORITY_LABELS[p]}</span>
        </>
      )}
      onSelect={onChange}
      onClose={onClose}
    />
  );
}
