import { Notice } from "obsidian";
import { StrictMode, useCallback, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { categoryOf } from "../../../../core/domain/fields";
import { parentProgress, type ParentProgress } from "../../../../core/domain/progress";
import type { Issue, Priority, Settings } from "../../../../core/domain/types";
import type { QueueTab } from "../../../../core/services";
import type KyleTicketsPlugin from "../main";
import { useIssues, useSettings } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { Avatar } from "./components/Avatar";
import { AttentionChip, DueChip, LabelChip, ProjectChip, shortDate } from "./components/chips";
import { PriorityIcon, StatusIcon } from "./components/icons";
import { PriorityPicker } from "./components/pickers/PriorityPicker";
import { StatusPicker } from "./components/pickers/StatusPicker";

/** Launch queue: the same rows as the ticket board for one tab (Todo / Triage), each with a Launch button. */
function QueueApp({ tab }: { tab: QueueTab }) {
  const plugin = usePlugin();
  const issues = useIssues();
  const settings = useSettings();
  const [, tick] = useState(0);
  const [picker, setPicker] = useState<{ kind: "status" | "priority"; id: string; anchor: HTMLElement } | null>(null);

  const svc = plugin.hub.services.get("tickets");
  const launcher = plugin.hub.services.get("launcher");
  const running = launcher?.runningTickets() ?? new Map<string, string>();
  const ready = useMemo(() => new Set((svc?.queue() ?? []).map((i) => i.id)), [svc, issues]);

  const { todo, triage } = useMemo(() => {
    const by = (cat: string) => issues.filter((i) => categoryOf(i.status, settings.statuses) === cat);
    const readyFirst = (a: Issue, b: Issue) => Number(ready.has(b.id)) - Number(ready.has(a.id));
    return { todo: [...by("unstarted"), ...by("backlog")].sort(readyFirst), triage: by("triage") };
  }, [issues, settings.statuses, ready]);
  const list = tab === "todo" ? todo : triage;
  const progress = useMemo(() => new Map(parentProgress(issues, settings.statuses).map((p) => [p.parent.id, p])), [issues, settings.statuses]);

  const open = useCallback((i: Issue, newTab: boolean) => plugin.hub.services.get("tickets")?.open?.(i.id, newTab), [plugin]);
  const update = (patch: { status?: string; priority?: Priority }) => {
    if (picker) void plugin.updateIssue(picker.id, patch).catch((e) => console.error("kyle-tickets: update failed", e));
  };
  const picked = picker ? issues.find((i) => i.id === picker.id) : undefined;

  return (
    <div className="kh-tickets-queue">
      <div className="kh-tickets-queue-list">
        {list.length === 0 && <div className="kh-tickets-queue-empty">Nothing in {tab === "todo" ? "Todo" : "Triage"}.</div>}
        {list.map((issue) => {
          const sid = running.get(issue.id);
          const isReady = ready.has(issue.id);
          return (
            <QueueCard
              key={issue.id}
              issue={issue}
              settings={settings}
              progress={progress.get(issue.id)}
              onOpen={open}
              onStatus={(i, anchor) => setPicker({ kind: "status", id: i.id, anchor })}
              onPriority={(i, anchor) => setPicker({ kind: "priority", id: i.id, anchor })}
              launch={<LaunchButton id={issue.id} ready={isReady} sessionId={sid} onDone={() => tick((n) => n + 1)} />}
            />
          );
        })}
      </div>
      {picker && picked && picker.kind === "status" && <StatusPicker anchor={picker.anchor} value={picked.status} onChange={(status) => update({ status })} onClose={() => setPicker(null)} />}
      {picker && picked && picker.kind === "priority" && <PriorityPicker anchor={picker.anchor} value={picked.priority} onChange={(priority) => update({ priority })} onClose={() => setPicker(null)} />}
    </div>
  );
}

/** Linear-style board card: id + assignee on top, status icon + bold title, chip row (priority, progress, labels), created date. */
function QueueCard({ issue, settings, progress, launch, onOpen, onStatus, onPriority }: {
  issue: Issue;
  settings: Settings;
  progress?: ParentProgress;
  launch: ReactNode;
  onOpen: (issue: Issue, newTab: boolean) => void;
  onStatus: (issue: Issue, anchor: HTMLElement) => void;
  onPriority: (issue: Issue, anchor: HTMLElement) => void;
}) {
  const def = settings.statuses.find((s) => s.name === issue.status);
  const stop = (fn: (anchor: HTMLElement) => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    fn(e.currentTarget);
  };
  return (
    <div className="kh-tickets-qcard" data-kh-tickets-id={issue.id} onClick={(e) => onOpen(issue, e.ctrlKey || e.metaKey)}>
      <div className="kh-tickets-qcard-top">
        <span className="kh-tickets-qcard-id">{issue.id}</span>
        {issue.assignee && <Avatar name={issue.assignee} className="kh-tickets-qcard-avatar" />}
      </div>
      <div className="kh-tickets-qcard-main">
        <button type="button" className="kh-tickets-row-btn" title={issue.status} onClick={stop((a) => onStatus(issue, a))}>
          <StatusIcon category={def?.category ?? "backlog"} color={def?.color} />
        </button>
        <span className="kh-tickets-qcard-title">{issue.title}</span>
      </div>
      <div className="kh-tickets-qcard-chips">
        <button type="button" className="kh-tickets-chip kh-tickets-qcard-chipbtn" title="Priority" onClick={stop((a) => onPriority(issue, a))}>
          <PriorityIcon priority={issue.priority} />
        </button>
        {progress && (
          <span className="kh-tickets-chip" title={`${progress.done} of ${progress.total} sub-issues done`}>
            <ProgressRing percent={progress.percent} />
            <span className="kh-tickets-chip-text">{progress.done}/{progress.total}</span>
          </span>
        )}
        <AttentionChip id={issue.id} />
        {issue.tags.map((t) => <LabelChip key={t} label={t} color={settings.labelColors[t]} />)}
        {issue.project && <ProjectChip project={issue.project} />}
        {issue.due && <DueChip due={issue.due} />}
        {launch}
      </div>
      {issue.created && <div className="kh-tickets-qcard-created">Created {shortDate(issue.created)}</div>}
    </div>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--interactive-accent)" strokeWidth="1.5" strokeDasharray={`${(c * percent) / 100} ${c}`} transform="rotate(-90 7 7)" />
    </svg>
  );
}

/** Ready tickets launch on one click; others need a second click (they skip the agent-ready human gate). */
function LaunchButton({ id, ready, sessionId, onDone }: { id: string; ready: boolean; sessionId?: string; onDone: () => void }) {
  const plugin = usePlugin();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const focus = (sid: string) => void plugin.hub.services.get("sessions")?.focus(sid);
  if (sessionId) {
    return (
      <button type="button" className="kh-tickets-queue-btn is-running" onClick={(e) => { e.stopPropagation(); focus(sessionId); }}>
        running
      </button>
    );
  }
  const click = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (!ready && !armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      const r = await plugin.hub.services.get("launcher")?.launch(id, { pick: e.shiftKey });
      if (!r) new Notice("kyle-hub: terminal sessions are unavailable.");
      else if (!r.ok) new Notice(`kyle-hub: ${r.message}`);
      else focus(r.sessionId);
    } catch (err) {
      new Notice(`kyle-hub: launch failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <button type="button" disabled={busy} title="Shift-click to choose the account" className={`kh-tickets-queue-btn${ready ? " mod-cta" : ""}`} onClick={(e) => void click(e)}>
      {armed ? "Click again to confirm" : ready ? "Launch" : "Launch (not agent-ready)"}
    </button>
  );
}

/** Renders the queue into `el` (the terminal view's right panel); returns an unmount function. */
export function mountQueue(plugin: KyleTicketsPlugin, el: HTMLElement, tab: QueueTab): () => void {
  el.addClass("kh-tickets-root");
  const root: Root = createRoot(el);
  root.render(
    <StrictMode>
      <PluginContext.Provider value={plugin}>
        <QueueApp tab={tab} />
      </PluginContext.Provider>
    </StrictMode>,
  );
  return () => root.unmount();
}
