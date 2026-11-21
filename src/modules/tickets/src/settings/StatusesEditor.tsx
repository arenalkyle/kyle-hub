import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS, normalizeOrder, renameStatusIn, sortedStatuses, STATUS_CATEGORIES, uniqueStatusName,
  validateDelete, validateStatuses,
} from "../../../../core/domain/statuses";
import type { StatusCategory, StatusDef } from "../../../../core/domain/types";
import { useIssues, useSettings } from "../store/hooks";
import { usePlugin } from "../views/PluginContext";
import { ColorInput } from "./ColorInput";
import { bulkWithProgress, chooseModal, confirmModal } from "./modals";

interface RowProps {
  status: StatusDef;
  count: number;
  isDefault: boolean;
  onRename: (to: string) => void;
  onColor: (color: string) => void;
  onCategory: (c: StatusCategory) => void;
  onDefault: () => void;
  onDelete: () => void;
}

function StatusRow({ status, count, isDefault, onRename, onColor, onCategory, onDefault, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.name });
  return (
    <div
      ref={setNodeRef}
      className={`kh-tickets-set-row${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="kh-tickets-set-handle" title="Drag to reorder" {...attributes} {...listeners}>
        {"⋮⋮"}
      </span>
      <ColorInput value={status.color} title="Color" onCommit={onColor} />
      <input
        key={status.name}
        className="kh-tickets-set-name"
        type="text"
        defaultValue={status.name}
        onBlur={(e) => {
          if (e.target.value.trim() === status.name) return;
          onRename(e.target.value);
          e.target.value = status.name;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            e.currentTarget.value = status.name;
            e.currentTarget.blur();
          }
        }}
      />
      <select className="dropdown" value={status.category} onChange={(e) => onCategory(e.target.value as StatusCategory)}>
        {STATUS_CATEGORIES.map((c) => (
          <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
        ))}
      </select>
      <span className="kh-tickets-set-count" title="Issues using this status">{count}</span>
      <button type="button" className={isDefault ? "mod-cta" : ""} disabled={isDefault} onClick={onDefault} title="Default for new issues">
        {isDefault ? "Default" : "Make default"}
      </button>
      <button type="button" className="mod-warning" onClick={onDelete}>Delete</button>
    </div>
  );
}

export function StatusesEditor() {
  const plugin = usePlugin();
  const settings = useSettings();
  const issues = useIssues();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const statuses = useMemo(() => sortedStatuses(settings.statuses), [settings.statuses]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of issues) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [issues]);
  const used = useMemo(() => {
    const cats = new Set<StatusCategory>();
    for (const s of statuses) if ((counts.get(s.name) ?? 0) > 0) cats.add(s.category);
    return cats;
  }, [statuses, counts]);

  const apply = async (
    next: StatusDef[],
    defaultStatus = settings.defaultStatus,
    usedCats: Iterable<StatusCategory> = used,
  ): Promise<boolean> => {
    const err = validateStatuses(next, defaultStatus, usedCats);
    setError(err);
    if (err) return false;
    await plugin.updateSettings({ statuses: normalizeOrder(next), defaultStatus });
    return true;
  };

  const rename = async (from: string, to: string) => {
    const r = renameStatusIn(statuses, from, to);
    if ("error" in r) return setError(r.error);
    const name = to.trim();
    const n = counts.get(from) ?? 0;
    if (n > 0) {
      const ok = await confirmModal(
        plugin.app,
        "Rename status",
        `Rename "${from}" to "${name}"? ${n} issue file${n === 1 ? "" : "s"} will be rewritten.`,
        "Rename",
      );
      if (!ok) return;
      await bulkWithProgress(plugin, "renaming status", (i) => i.status === from, { status: name });
    }
    await apply(r.statuses, settings.defaultStatus === from ? name : settings.defaultStatus, used);
  };

  const remove = async (name: string) => {
    const n = counts.get(name) ?? 0;
    const others = statuses.filter((s) => s.name !== name).map((s) => s.name);
    let target: string | undefined;
    if (n > 0) {
      const pre = validateDelete(statuses, settings.defaultStatus, name, others[0], n, used);
      if (pre) return setError(pre);
      const pick = await chooseModal(
        plugin.app,
        "Delete status",
        `Move ${n} issue${n === 1 ? "" : "s"} from "${name}" to:`,
        others,
        "Move and delete",
      );
      if (pick === null) return;
      target = pick;
    }
    // Categories still in use after the move.
    const after = new Set<StatusCategory>(used);
    if (target !== undefined) {
      const cat = statuses.find((s) => s.name === target)?.category;
      if (cat) after.add(cat);
    }
    const err = validateDelete(statuses, settings.defaultStatus, name, target, n, after);
    if (err) return setError(err);
    if (n === 0) {
      const ok = await confirmModal(plugin.app, "Delete status", `Delete the status "${name}"?`, "Delete", true);
      if (!ok) return;
    }
    if (n > 0) await bulkWithProgress(plugin, "moving issues", (i) => i.status === name, { status: target! });
    await apply(statuses.filter((s) => s.name !== name), settings.defaultStatus, after);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = statuses.findIndex((s) => s.name === e.active.id);
    const to = statuses.findIndex((s) => s.name === e.over!.id);
    if (from >= 0 && to >= 0) void apply(arrayMove(statuses, from, to));
  };

  return (
    <div className="kh-tickets-set-editor">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={statuses.map((s) => s.name)} strategy={verticalListSortingStrategy}>
          {statuses.map((s) => (
            <StatusRow
              key={s.name}
              status={s}
              count={counts.get(s.name) ?? 0}
              isDefault={s.name === settings.defaultStatus}
              onRename={(to) => void rename(s.name, to)}
              onColor={(color) => void apply(statuses.map((x) => (x.name === s.name ? { ...x, color } : x)))}
              onCategory={(category) =>
                void apply(statuses.map((x) => (x.name === s.name ? { ...x, category } : x)))
              }
              onDefault={() => void apply(statuses, s.name)}
              onDelete={() => void remove(s.name)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {error && <div className="kh-tickets-set-error">{error}</div>}
      <button
        type="button"
        onClick={() =>
          void apply([...statuses, { name: uniqueStatusName(statuses), category: "started", color: "#888888", order: statuses.length }])
        }
      >
        Add status
      </button>
    </div>
  );
}
