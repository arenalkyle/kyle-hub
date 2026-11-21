import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Notice } from "obsidian";
import { useMemo, useState } from "react";
import { setFilterValues, type Filter } from "../../../../../core/domain/filters";
import { isMilestoneOverdue, milestoneProgress, moveItem, validateMilestoneName } from "../../../../../core/domain/milestones";
import { formatDate } from "../../../../../core/domain/time";
import type { Project } from "../../../../../core/domain/types";
import { confirmModal, withProgressNotice } from "../../settings/modals";
import { useIssues, useSettings } from "../../store/hooks";
import { usePlugin } from "../PluginContext";
import { DatePicker } from "../components/pickers/DatePicker";
import { Icon } from "../components/icons";
import { MilestoneRow } from "./MilestoneRow";

export interface MilestonesProps {
  project: Project;
  color: string;
  filters: readonly Filter[];
  onFiltersChange: (next: Filter[]) => void;
}

function AddMilestone({ project, onDone }: { project: Project; onDone: () => void }) {
  const plugin = usePlugin();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string | undefined>();
  const [desc, setDesc] = useState("");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const error = name.trim() === "" ? null : validateMilestoneName(name, project.milestones.map((m) => m.name));
  const submit = () => {
    const bad = validateMilestoneName(name, project.milestones.map((m) => m.name));
    if (bad) {
      new Notice(bad);
      return;
    }
    void plugin.store
      .addMilestone(project.name, { name, target, description: desc.trim() || undefined })
      .then(onDone)
      .catch((e: unknown) => new Notice(`Could not add the milestone${e instanceof Error ? `: ${e.message}` : "."}`));
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") onDone();
  };
  return (
    <div className="kt-ms-add">
      <input autoFocus value={name} placeholder="Milestone name" onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
      <button type="button" className="kt-prop-btn" onClick={(e) => setAnchor(e.currentTarget)}>
        <Icon name="calendar" />
        <span>{target ?? "Target date"}</span>
      </button>
      <input value={desc} placeholder="Description (optional)" onChange={(e) => setDesc(e.target.value)} onKeyDown={keys} />
      <button type="button" className="mod-cta" disabled={name.trim() === "" || error !== null} onClick={submit}>
        Add
      </button>
      <button type="button" onClick={onDone}>
        Cancel
      </button>
      {error && <span className="kt-field-error">{error}</span>}
      {anchor && <DatePicker anchor={anchor} value={target} onChange={setTarget} onClose={() => setAnchor(null)} />}
    </div>
  );
}

/** Milestones section of a project page: progress, inline edit, drag to reorder, click to filter. */
export function Milestones({ project, color, filters, onFiltersChange }: MilestonesProps) {
  const plugin = usePlugin();
  const issues = useIssues();
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const progress = useMemo(() => milestoneProgress(project, issues, settings.statuses), [project, issues, settings.statuses]);
  const today = formatDate(new Date());
  const active = filters.find((f) => f.field === "milestone" && f.op === "in");
  const names = project.milestones.map((m) => m.name);

  const fail = (what: string) => (e: unknown) => {
    console.error(`kyle-tickets: ${what} failed`, e);
    new Notice(`Could not ${what}${e instanceof Error ? `: ${e.message}` : "."}`);
  };

  const toggleFilter = (name: string) => {
    const on = active?.values.length === 1 && active.values[0]!.toLowerCase() === name.toLowerCase();
    const without = filters.filter((f) => f.field !== "milestone");
    onFiltersChange(on ? without : setFilterValues(without, "milestone", [name]));
  };

  const rename = (old: string, next: string) => {
    const bad = validateMilestoneName(next, names, old);
    if (bad) {
      new Notice(bad);
      return;
    }
    // Keep the filter chip on the renamed milestone.
    if (active?.values.some((v) => v.toLowerCase() === old.toLowerCase())) {
      onFiltersChange(filters.map((f) => (f === active ? { ...f, values: f.values.map((v) => (v.toLowerCase() === old.toLowerCase() ? next.trim() : v)) } : f)));
    }
    void withProgressNotice("renaming milestone", (onProgress) => plugin.store.renameMilestone(project.name, old, next, { onProgress })).catch(fail("rename the milestone"));
  };

  const remove = async (name: string) => {
    const count = progress.find((p) => p.name === name)?.total ?? 0;
    const ok = await confirmModal(
      plugin.app,
      "Delete milestone",
      `Delete milestone "${name}"?${count > 0 ? ` ${count} issue${count === 1 ? "" : "s"} will have the milestone cleared.` : ""}`,
      "Delete",
      true,
    );
    if (!ok) return;
    if (active?.values.some((v) => v.toLowerCase() === name.toLowerCase())) onFiltersChange(filters.filter((f) => f !== active));
    void withProgressNotice("clearing milestone", (onProgress) => plugin.store.deleteMilestone(project.name, name, { onProgress })).catch(fail("delete the milestone"));
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = names.indexOf(String(e.active.id));
    const to = names.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    void plugin.store.reorderMilestones(project.name, moveItem(names, from, to)).catch(fail("reorder the milestones"));
  };

  return (
    <section className="kt-milestones">
      <div className="kt-ms-head">
        <h3>Milestones</h3>
        <button type="button" className="clickable-icon" title="Add milestone" aria-label="Add milestone" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
        </button>
      </div>
      {adding && <AddMilestone project={project} onDone={() => setAdding(false)} />}
      {project.milestones.length === 0 && !adding && <div className="kt-ms-empty">No milestones yet</div>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={names} strategy={verticalListSortingStrategy}>
          <ul className="kt-ms-list">
            {project.milestones.map((m) => {
              const p = progress.find((x) => x.name === m.name) ?? { name: m.name, done: 0, total: 0, percent: 0 };
              return (
                <MilestoneRow
                  key={m.name}
                  milestone={m}
                  progress={p}
                  overdue={isMilestoneOverdue(m, p, today)}
                  color={color}
                  active={active?.values.length === 1 && active.values[0]!.toLowerCase() === m.name.toLowerCase()}
                  onToggleFilter={() => toggleFilter(m.name)}
                  onRename={(n) => rename(m.name, n)}
                  onPatch={(patch) => void plugin.store.updateMilestone(project.name, m.name, patch).catch(fail("save the milestone"))}
                  onDelete={() => void remove(m.name)}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}
