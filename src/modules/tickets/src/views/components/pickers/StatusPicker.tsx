import { useMemo } from "react";
import type { StatusDef } from "../../../../../../core/domain/types";
import { usePlugin } from "../../PluginContext";
import { Picker } from "../Picker";
import { StatusIcon } from "../icons";

export interface StatusPickerProps {
  anchor: HTMLElement | null;
  value: string;
  onChange: (status: string) => void;
  onClose: () => void;
}

export function StatusPicker({ anchor, value, onChange, onClose }: StatusPickerProps) {
  const { data } = usePlugin();
  const items = useMemo(() => [...data.settings.statuses].sort((a, b) => a.order - b.order), [data.settings.statuses]);
  return (
    <Picker<StatusDef>
      anchor={anchor}
      items={items}
      getKey={(s) => s.name}
      getSearch={(s) => [s.name]}
      selectedKeys={[value]}
      searchable={false}
      renderItem={(s) => (
        <>
          <StatusIcon category={s.category} color={s.color} />
          <span className="kh-tickets-picker-label">{s.name}</span>
        </>
      )}
      onSelect={(s) => onChange(s.name)}
      onClose={onClose}
    />
  );
}
