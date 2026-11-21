import { useMemo } from "react";
import { nextLabelColor } from "../../../../../../core/domain/match";
import { useIssues } from "../../../store/hooks";
import { usePlugin } from "../../PluginContext";
import { Picker } from "../Picker";
import { Dot } from "../icons";

export interface LabelPickerProps {
  anchor: HTMLElement | null;
  value: readonly string[];
  onChange: (labels: string[]) => void;
  onClose: () => void;
}

export function LabelPicker({ anchor, value, onChange, onClose }: LabelPickerProps) {
  const plugin = usePlugin();
  const issues = useIssues();
  const colors = plugin.data.settings.labelColors;
  const all = useMemo(() => {
    const set = new Set<string>(Object.keys(colors));
    for (const i of issues) for (const t of i.tags) set.add(t);
    for (const t of value) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [issues, colors, value]);

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((v) => v !== name) : [...value, name]);

  return (
    <Picker<string>
      anchor={anchor}
      items={all}
      multi
      getKey={(n) => n}
      getSearch={(n) => [n]}
      selectedKeys={value}
      placeholder="Add labels..."
      renderItem={(n) => (
        <>
          <Dot color={colors[n] ?? "var(--text-faint)"} />
          <span className="kt-picker-label">{n}</span>
        </>
      )}
      create={{
        label: (q) => `Create new label "${q}"`,
        onCreate: (name) => {
          const { labelColors } = plugin.data.settings;
          if (!labelColors[name]) {
            labelColors[name] = nextLabelColor(labelColors);
            void plugin.savePluginData();
          }
          if (!value.includes(name)) onChange([...value, name]);
        },
      }}
      onSelect={toggle}
      onClose={onClose}
    />
  );
}
