import { useMemo } from "react";
import { formatDate } from "../../../../../../core/domain/time";
import { Picker } from "../Picker";
import { Icon } from "../icons";

interface Quick {
  label: string;
  /** `null` clears the date. */
  date: string | null;
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

export interface DatePickerProps {
  anchor: HTMLElement | null;
  value: string | undefined;
  onChange: (date: string | undefined) => void;
  onClose: () => void;
}

export function DatePicker({ anchor, value, onChange, onClose }: DatePickerProps) {
  const items = useMemo<Quick[]>(
    () => [
      { label: "Today", date: addDays(0) },
      { label: "Tomorrow", date: addDays(1) },
      { label: "Next week", date: addDays(7) },
      { label: "Clear", date: null },
    ],
    [],
  );
  return (
    <Picker<Quick>
      anchor={anchor}
      items={items}
      getKey={(i) => i.label}
      getSearch={(i) => [i.label]}
      placeholder="Set due date..."
      renderItem={(i) => (
        <>
          <Icon name="calendar" />
          <span className="kh-tickets-picker-label">{i.label}</span>
          {i.date && <span className="kh-tickets-picker-meta">{i.date}</span>}
        </>
      )}
      footer={
        <div className="kh-tickets-picker-footer">
          <input
            type="date"
            className="kh-tickets-date-input"
            value={value ?? ""}
            onChange={(e) => {
              onChange(e.target.value || undefined);
              if (e.target.value) onClose();
            }}
          />
        </div>
      }
      onSelect={(i) => onChange(i.date ?? undefined)}
      onClose={onClose}
    />
  );
}
