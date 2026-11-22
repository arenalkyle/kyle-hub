import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { StrictMode, useCallback, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { defaultDisplay } from "../../../../core/domain/display";
import { categoryOf } from "../../../../core/domain/fields";
import type { Issue, Priority } from "../../../../core/domain/types";
import type KyleTicketsPlugin from "../main";
import { useIssues, useSettings } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { PriorityPicker } from "./components/pickers/PriorityPicker";
import { StatusPicker } from "./components/pickers/StatusPicker";
import { IssueRow } from "./main/IssueRow";

export const VIEW_TYPE_QUEUE = "kh-tickets-queue";

type Tab = "triage" | "todo";
const PROPS = defaultDisplay().properties;

/** Launch queue: the same rows as the ticket board, split into Todo / Triage, each with a Launch button. */
function QueueApp() {
  const plugin = usePlugin();
  const issues = useIssues();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>("todo");
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

  const open = useCallback((i: Issue, newTab: boolean) => plugin.hub.services.get("tickets")?.open?.(i.id, newTab), [plugin]);
  const update = (patch: { status?: string; priority?: Priority }) => {
    if (picker) void plugin.updateIssue(picker.id, patch).catch((e) => console.error("kyle-tickets: update failed", e));
  };
  const picked = picker ? issues.find((i) => i.id === picker.id) : undefined;

  return (
    <div className="kh-tickets-queue">
      <div className="kh-tickets-queue-tabs" role="tablist">
        {([["todo", "Todo", todo.length], ["triage", "Triage", triage.length]] as const).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`kh-tickets-queue-tab${tab === k ? " is-active" : ""}`} onClick={() => setTab(k)}>
            {label} <span className="kh-tickets-group-count">{n}</span>
          </button>
        ))}
      </div>
      <div className="kh-tickets-queue-list">
        {list.length === 0 && <div className="kh-tickets-queue-empty">Nothing in {tab === "todo" ? "Todo" : "Triage"}.</div>}
        {list.map((issue) => {
          const sid = running.get(issue.id);
          const isReady = ready.has(issue.id);
          return (
            <div key={issue.id} className="kh-tickets-item kh-tickets-queue-item">
              <IssueRow
                issue={issue}
                settings={settings}
                properties={PROPS}
                onOpen={open}
                onStatus={(i, anchor) => setPicker({ kind: "status", id: i.id, anchor })}
                onPriority={(i, anchor) => setPicker({ kind: "priority", id: i.id, anchor })}
                extra={<LaunchButton id={issue.id} ready={isReady} sessionId={sid} onDone={() => tick((n) => n + 1)} />}
              />
            </div>
          );
        })}
      </div>
      {picker && picked && picker.kind === "status" && <StatusPicker anchor={picker.anchor} value={picked.status} onChange={(status) => update({ status })} onClose={() => setPicker(null)} />}
      {picker && picked && picker.kind === "priority" && <PriorityPicker anchor={picker.anchor} value={picked.priority} onChange={(priority) => update({ priority })} onClose={() => setPicker(null)} />}
    </div>
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

export class QueueView extends ItemView {
  private root: Root | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: KyleTicketsPlugin) {
    super(leaf);
  }

  override getViewType(): string { return VIEW_TYPE_QUEUE; }
  override getDisplayText(): string { return "Queue"; }
  override getIcon(): string { return "list-checks"; }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-tickets-root");
    this.root = createRoot(this.contentEl);
    this.root.render(
      <StrictMode>
        <PluginContext.Provider value={this.plugin}>
          <QueueApp />
        </PluginContext.Provider>
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
