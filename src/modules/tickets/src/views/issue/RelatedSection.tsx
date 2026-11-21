import { useMemo, useRef, useState } from "react";
import { relatedIds } from "../../../../../core/domain/related";
import type { Issue, Settings } from "../../../../../core/domain/types";
import { useIssues } from "../../store/hooks";
import { Icon, StatusIcon } from "../components/icons";
import { Picker } from "../components/Picker";

export interface RelatedSectionProps {
  issue: Issue;
  settings: Settings;
  onOpenIssue: (id: string) => void;
  onAdd: (otherId: string) => void;
  onRemove: (otherId: string) => void;
}

function StatusOf({ issue, settings }: { issue: Issue; settings: Settings }) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  return <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />;
}

export function RelatedSection({ issue, settings, onOpenIssue, onAdd, onRemove }: RelatedSectionProps) {
  const all = useIssues();
  const related = useMemo(() => {
    const byId = new Map(all.map((i) => [i.id, i]));
    return relatedIds(issue, all).flatMap((id) => byId.get(id) ?? []);
  }, [issue, all]);
  const candidates = useMemo(() => {
    const taken = new Set([issue.id, ...related.map((r) => r.id)]);
    return all.filter((i) => !taken.has(i.id));
  }, [all, issue.id, related]);
  const [picking, setPicking] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <div className="kt-prop-group-title">Related</div>
      {related.map((r) => (
        <div key={r.id} className="kt-related-row">
          <button type="button" className="kt-prop-value kt-related-open" title={`${r.id} ${r.title}`} onClick={() => onOpenIssue(r.id)}>
            <StatusOf issue={r} settings={settings} />
            <span>{r.title}</span>
          </button>
          <button type="button" className="kt-related-remove clickable-icon" aria-label={`Remove related ${r.id}`} title="Remove" onClick={() => onRemove(r.id)}>
            ×
          </button>
        </div>
      ))}
      <button ref={addRef} type="button" className="kt-prop-value kt-related-add" onClick={() => setPicking(true)}>
        <Icon name="plus" size={14} />
        <span>Add related</span>
      </button>
      {picking && (
        <Picker<Issue>
          anchor={addRef.current}
          items={candidates}
          getKey={(i) => i.id}
          getSearch={(i) => [i.title, i.id]}
          placeholder="Add related issue..."
          renderItem={(i) => (
            <>
              <span className="kt-picker-icon"><StatusOf issue={i} settings={settings} /></span>
              <span className="kt-picker-label">{i.id} {i.title}</span>
            </>
          )}
          onSelect={(i) => onAdd(i.id)}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
