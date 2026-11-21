import { useMemo, useState } from "react";
import { useIssues, useSettings } from "../store/hooks";
import { usePlugin } from "../views/PluginContext";
import { ColorInput } from "./ColorInput";
import { bulkWithProgress, confirmModal, promptModal } from "./modals";

const FALLBACK_COLOR = "#888888";

export function LabelsEditor() {
  const plugin = usePlugin();
  const settings = useSettings();
  const issues = useIssues();
  const [error, setError] = useState<string | null>(null);

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const name of Object.keys(settings.labelColors)) counts.set(name, 0);
    for (const i of issues) for (const t of new Set(i.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [issues, settings.labelColors]);

  const setColor = (name: string, color: string) =>
    void plugin.updateSettings({ labelColors: { ...plugin.data.settings.labelColors, [name]: color } });

  const rename = async (from: string, count: number) => {
    const input = await promptModal(plugin.app, "Rename label", from, "Rename");
    const to = input?.trim();
    if (!to || to === from) return;
    if (/\s/.test(to)) return setError("Labels cannot contain spaces.");
    setError(null);
    const merge = labels.some(([n]) => n === to);
    const ok = await confirmModal(
      plugin.app,
      "Rename label",
      `Rename "${from}" to "${to}" on ${count} issue${count === 1 ? "" : "s"}?${merge ? ` "${to}" already exists, so they will be merged.` : ""}`,
      "Rename",
    );
    if (!ok) return;
    await bulkWithProgress(plugin, "renaming label", (i) => i.tags.includes(from), (i) => ({
      tags: [...new Set(i.tags.map((t) => (t === from ? to : t)))],
    }));
    const { [from]: color, ...rest } = plugin.data.settings.labelColors;
    await plugin.updateSettings({ labelColors: { ...rest, [to]: rest[to] ?? color ?? FALLBACK_COLOR } });
  };

  const remove = async (name: string, count: number) => {
    const ok = await confirmModal(
      plugin.app,
      "Delete label",
      `Remove "${name}" from ${count} issue${count === 1 ? "" : "s"}? This cannot be undone.`,
      "Delete",
      true,
    );
    if (!ok) return;
    setError(null);
    await bulkWithProgress(plugin, "deleting label", (i) => i.tags.includes(name), (i) => ({
      tags: i.tags.filter((t) => t !== name),
    }));
    const rest = { ...plugin.data.settings.labelColors };
    delete rest[name];
    await plugin.updateSettings({ labelColors: rest });
  };

  return (
    <div className="kh-tickets-set-editor">
      {labels.length === 0 && <div className="kh-tickets-set-empty">No labels yet. Labels appear here once an issue uses one.</div>}
      {labels.map(([name, count]) => (
        <div key={name} className="kh-tickets-set-row">
          <ColorInput value={settings.labelColors[name] ?? FALLBACK_COLOR} title="Color" onCommit={(c) => setColor(name, c)} />
          <span className="kh-tickets-set-label-name">{name}</span>
          <span className="kh-tickets-set-count" title="Issues using this label">{count}</span>
          <button type="button" onClick={() => void rename(name, count)}>Rename</button>
          <button type="button" className="mod-warning" onClick={() => void remove(name, count)}>Delete</button>
        </div>
      ))}
      {error && <div className="kh-tickets-set-error">{error}</div>}
    </div>
  );
}
