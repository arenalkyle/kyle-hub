import { useMemo, useRef, useState, type ReactNode } from "react";
import { effectiveType, MODELS, TICKET_TYPES, type Model, type TicketType } from "../../../../../core/domain/fields";
import type { IssuePatch } from "../../../../../core/domain/issueFile";
import type { Issue, Settings } from "../../../../../core/domain/types";
import { useIssues } from "../../store/hooks";
import { usePlugin } from "../PluginContext";
import { TypeChip } from "../components/chips";
import { Icon, StatusIcon } from "../components/icons";
import { Picker } from "../components/Picker";

type Kind = "type" | "repo" | "model" | "blockedBy";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const NONE = "(none)";

function ReadOnly({ label, value, field }: { label: string; value: ReactNode; field: string }) {
  return (
    <div className="kh-tickets-prop kh-tickets-prop-readonly" data-kh-tickets-field={field}>
      <span className="kh-tickets-prop-key">{label}</span>
      <span className="kh-tickets-prop-static">{value}</span>
    </div>
  );
}

export interface FieldsSectionProps {
  issue: Issue;
  settings: Settings;
  onUpdate: (patch: IssuePatch) => void;
  onOpenIssue: (id: string) => void;
}

/** Type, Repo, Model, Blocked by (editable) and Runs, Outcome, Cost, Source (read-only). */
export function FieldsSection({ issue, settings, onUpdate, onOpenIssue }: FieldsSectionProps) {
  const plugin = usePlugin();
  const all = useIssues();
  const [open, setOpen] = useState<{ kind: Kind; anchor: HTMLElement | null } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const repos = plugin.repoKeys();
  const blockers = useMemo(() => {
    const byId = new Map(all.map((i) => [i.id, i]));
    return (issue.blockedBy ?? []).map((id) => ({ id, issue: byId.get(id) }));
  }, [all, issue.blockedBy]);
  const candidates = useMemo(() => all.filter((i) => i.id !== issue.id && !(issue.blockedBy ?? []).includes(i.id)), [all, issue.id, issue.blockedBy]);
  const close = (): void => setOpen(null);
  const row = (kind: Kind, label: string, children: ReactNode) => (
    <div className="kh-tickets-prop">
      <button type="button" className="kh-tickets-prop-value" data-kh-tickets-prop={kind} title={label} aria-label={label} onClick={(e) => setOpen({ kind, anchor: e.currentTarget })}>
        {children}
      </button>
    </div>
  );
  const strOption = (items: string[], value: string | undefined, onPick: (v: string) => void, label: (v: string) => string = cap) => (
    <Picker<string>
      anchor={open?.anchor ?? null}
      items={items}
      getKey={(v) => v}
      getSearch={(v) => [v]}
      selectedKeys={value ? [value] : []}
      searchable={items.length > 8}
      renderItem={(v) => <span className="kh-tickets-picker-label">{label(v)}</span>}
      onSelect={onPick}
      onClose={close}
    />
  );
  return (
    <>
      <div className="kh-tickets-prop-group-title">Ticket</div>
      {row("type", "Type", <TypeChip type={issue.type} />)}
      {row("repo", "Repo", issue.repo ? <span>{issue.repo}</span> : <span className="kh-tickets-prop-empty">Set repo</span>)}
      {row("model", "Model", issue.model ? <span>{cap(issue.model)}</span> : <span className="kh-tickets-prop-empty">Set model</span>)}
      <div className="kh-tickets-prop-group-title">Blocked by</div>
      {blockers.map((b) => {
        const def = b.issue ? settings.statuses.find((s) => s.name === b.issue!.status) : undefined;
        return (
          <div key={b.id} className="kh-tickets-related-row">
            <button type="button" className="kh-tickets-prop-value kh-tickets-related-open" title={b.issue ? `${b.id} ${b.issue.title}` : b.id} onClick={() => onOpenIssue(b.id)}>
              {b.issue && <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />}
              <span>{b.issue ? `${b.id} ${b.issue.title}` : `${b.id} (missing)`}</span>
            </button>
            <button type="button" className="kh-tickets-related-remove clickable-icon" aria-label={`Remove blocker ${b.id}`} title="Remove" onClick={() => onUpdate({ blockedBy: (issue.blockedBy ?? []).filter((x) => x !== b.id) })}>
              ×
            </button>
          </div>
        );
      })}
      <button ref={addRef} type="button" className="kh-tickets-prop-value kh-tickets-related-add" data-kh-tickets-prop="blockedBy" onClick={() => setOpen({ kind: "blockedBy", anchor: addRef.current })}>
        <Icon name="plus" size={14} />
        <span>Add blocker</span>
      </button>
      <div className="kh-tickets-prop-group-title">Agent</div>
      <ReadOnly label="Runs" field="runs" value={issue.runs && issue.runs.length > 0 ? issue.runs.length : "None"} />
      <ReadOnly label="Outcome" field="outcome" value={issue.outcome ? cap(issue.outcome) : "None"} />
      <ReadOnly label="Cost" field="cost" value={issue.costUsd !== undefined ? `$${issue.costUsd.toFixed(2)}` : "None"} />
      <ReadOnly label="Source" field="source" value={issue.source ?? "human"} />

      {open?.kind === "type" && strOption([...TICKET_TYPES], effectiveType(issue), (v) => onUpdate({ type: v as TicketType }))}
      {open?.kind === "repo" && strOption([NONE, ...repos], issue.repo ?? NONE, (v) => onUpdate({ repo: v === NONE ? null : v }), (v) => v)}
      {open?.kind === "model" && strOption([NONE, ...MODELS], issue.model ?? NONE, (v) => onUpdate({ model: v === NONE ? null : (v as Model) }), (v) => (v === NONE ? v : cap(v)))}
      {open?.kind === "blockedBy" && (
        <Picker<Issue>
          anchor={open.anchor}
          items={candidates}
          getKey={(i) => i.id}
          getSearch={(i) => [i.title, i.id]}
          placeholder="Add blocking issue..."
          renderItem={(i) => (
            <span className="kh-tickets-picker-label">
              {i.id} {i.title}
            </span>
          )}
          onSelect={(i) => onUpdate({ blockedBy: [...(issue.blockedBy ?? []), i.id] })}
          onClose={close}
        />
      )}
    </>
  );
}
