import { Notice } from "obsidian";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultDisplay } from "../../../../../core/domain/display";
import { ageLabel, seenCount, triageIssues, type TriageAction, type UndoEntry } from "../../../../../core/domain/triage";
import { runTriage, undoTriage } from "../../triageActions";
import { useIssues, useSettings } from "../../store/hooks";
import { usePlugin } from "../PluginContext";
import { Icon } from "../components/icons";
import { moveSelection, useTriageKeys, type TriageKeyAction } from "../shortcuts";
import { IssueRow } from "./IssueRow";

const ITEM_HEIGHT = 36;
const PROPS = { ...defaultDisplay().properties, status: false, priority: false, pullRequests: false, due: false, assignee: false, created: false };
const noop = (): void => undefined;

export interface TriageViewProps {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

function Chip({ kind, title, text, muted }: { kind: string; title: string; text: string; muted?: boolean }) {
  return (
    <span className={`kh-tickets-chip${muted ? " kh-tickets-chip-muted" : ""}`} title={title} data-kh-tickets-chip={kind}>
      <span className="kh-tickets-chip-text">{text}</span>
    </span>
  );
}

/** Triage list (triage-category tickets, newest first) with its own keymap; every action goes through `TicketService`. */
export function TriageView({ sidebarCollapsed = false, onToggleSidebar }: TriageViewProps) {
  const plugin = usePlugin();
  const issues = useIssues();
  const settings = useSettings();
  const rootRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Tickets whose action is still writing stay hidden so a fast key sequence acts on the next row.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const undo = useRef<UndoEntry[]>([]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const now = new Date();

  const list = useMemo(() => triageIssues(issues, settings.statuses).filter((i) => !busy.has(i.id)), [issues, settings.statuses, busy]);
  const ids = useMemo(() => list.map((i) => i.id), [list]);
  const current = selectedId !== null && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (current === null) return;
    rootRef.current?.querySelector(`[data-kh-tickets-id="${CSS.escape(current)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const service = () => {
    const s = plugin.hub.services.get("tickets");
    if (!s) new Notice("The tickets service is not available.");
    return s;
  };
  const enqueue = (id: string, work: () => Promise<void>): void => {
    setBusy((b) => new Set(b).add(id));
    queue.current = queue.current
      .then(work)
      .catch((e) => {
        console.error("kyle-tickets: triage action failed", e);
        new Notice("Triage action failed.");
      })
      .finally(() =>
        setBusy((b) => {
          const next = new Set(b);
          next.delete(id);
          return next;
        }),
      );
  };

  const act = (id: string, action: TriageAction, why = ""): void => {
    const svc = service();
    if (!svc || !svc.get(id)) return;
    const at = ids.indexOf(id);
    setSelectedId(ids[at + 1] ?? ids[at - 1] ?? null);
    enqueue(id, async () => {
      const entry = await runTriage(svc, id, action, settings, why);
      if (entry) undo.current.push(entry);
      else new Notice("No target status for this action; check the status settings.");
    });
  };

  const undoLast = (): void => {
    const entry = undo.current.pop();
    const svc = service();
    if (!entry || !svc) return;
    setSelectedId(entry.id);
    enqueue(entry.id, () => undoTriage(svc, entry));
  };

  // The handler is re-created every render; the key hook re-binds the listener each time.
  const onKey = (action: TriageKeyAction): boolean => {
    if (declining !== null) return false;
    switch (action) {
      case "next":
      case "prev":
        setSelectedId(moveSelection(ids, current, action === "next" ? 1 : -1));
        return true;
      case "open":
        if (current === null) return false;
        plugin.openIssue(current);
        return true;
      case "accept":
      case "ready":
        if (current === null) return false;
        act(current, action);
        return true;
      case "decline":
        if (current === null) return false;
        setReason("");
        setDeclining(current);
        return true;
      case "undo":
        undoLast();
        return true;
    }
  };
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useTriageKeys(rootRef, useCallback((a: TriageKeyAction) => onKeyRef.current(a), []));

  const finishDecline = (confirm: boolean): void => {
    const id = declining;
    setDeclining(null);
    rootRef.current?.focus({ preventScroll: true });
    if (confirm && id) act(id, "decline", reason);
  };

  return (
    <div
      className="kh-tickets-collection kh-tickets-triage"
      ref={rootRef}
      tabIndex={-1}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div className="kh-tickets-header">
        {onToggleSidebar && (
          <button type="button" className="kh-tickets-icon-btn" title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"} onClick={onToggleSidebar}>
            <Icon name="panel-left" size={16} />
          </button>
        )}
        <h2 className="kh-tickets-header-title">Triage</h2>
        <span className="kh-tickets-header-count">{list.length}</span>
        <div className="kh-tickets-header-spacer" />
        <span className="kh-tickets-triage-hint">j/k move, Enter open, a accept, r accept + agent-ready, d decline, u undo</span>
      </div>
      {list.length === 0 ? (
        <div className="kh-tickets-empty">
          <div>Nothing to triage</div>
        </div>
      ) : (
        <div className="kh-tickets-list">
          {list.map((issue) => {
            const seen = seenCount(issue);
            const extra = (
              <>
                {issue.source && issue.source !== "human" && <Chip kind="source" title={`Source: ${issue.source}`} text={issue.source} />}
                {issue.repo && <Chip kind="repo" title={`Repo: ${issue.repo}`} text={issue.repo} />}
                <Chip kind="age" title={`Created ${issue.created ?? ""}`} text={ageLabel(issue.created, now)} muted />
                {seen > 0 && <Chip kind="seen" title="Seen again (deduplicated)" text={`+${seen} seen`} />}
              </>
            );
            return (
              <div key={issue.id} style={{ height: ITEM_HEIGHT }}>
                <IssueRow issue={issue} settings={settings} properties={PROPS} selected={issue.id === current} extra={extra} onOpen={(i) => plugin.openIssue(i.id)} onStatus={noop} onPriority={noop} />
                {declining === issue.id && (
                  <div className="kh-tickets-triage-decline">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Reason for declining (Enter to confirm, Esc to cancel)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") finishDecline(true);
                        else if (e.key === "Escape") finishDecline(false);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
