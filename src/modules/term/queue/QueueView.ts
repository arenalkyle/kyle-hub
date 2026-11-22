import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import type { Issue } from "../../../core/domain/types";
import { categoryOf, effectiveType } from "../../../core/domain/fields";
import { parentProgress, type ParentProgress } from "../../../core/domain/progress";
import type { Hub } from "../../../core";
import type { Launcher } from "../launch/launch";

export const QUEUE_VIEW_TYPE = "kh-term-queue-view";

/** Right-sidebar list of queued tickets with a Launch button each (reads tickets through `services` only). */
export class QueueView extends ItemView {
  private offs: (() => void)[] = [];
  private offTickets: (() => void) | null = null;
  private subscribedTo: unknown = null;
  private pending = false;

  constructor(leaf: WorkspaceLeaf, private hub: Hub, private launcher: () => Launcher | null, private focus: (sessionId: string) => Promise<void>) {
    super(leaf);
  }

  getViewType(): string { return QUEUE_VIEW_TYPE; }
  getDisplayText(): string { return "Queue"; }
  override getIcon(): string { return "list-todo"; }

  override async onOpen(): Promise<void> {
    this.contentEl.addClass("kh-term-queue");
    const { events } = this.hub;
    const bump = () => this.schedule();
    this.offs.push(events.on("ticket:created", bump), events.on("ticket:status-changed", bump), events.on("ticket:label-changed", bump));
    this.offs.push(events.on("session:started", bump), events.on("session:ended", bump));
    this.offs.push(events.on("session:needs-attention", bump), events.on("session:attention-cleared", bump));
    this.render();
  }

  override async onClose(): Promise<void> {
    this.offs.forEach((o) => o());
    this.offs = [];
    this.offTickets?.();
    this.offTickets = null;
    this.subscribedTo = null;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    window.setTimeout(() => {
      this.pending = false;
      this.render();
    }, 50);
  }

  render(): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("h4", { cls: "kh-term-queue-title", text: "Queue" });
    const tickets = this.hub.services.get("tickets");
    if (this.subscribedTo !== tickets) {
      this.offTickets?.();
      this.offTickets = tickets ? tickets.subscribe(() => this.schedule()) : null;
      this.subscribedTo = tickets;
    }
    if (!tickets) {
      el.createDiv({ cls: "kh-term-queue-empty", text: "Tickets module disabled. Turn it on in the kyle-hub settings to see the queue." });
      return;
    }
    const items = tickets.queue();
    const running = this.launcher()?.runningTickets() ?? new Map<string, string>();
    const statuses = tickets.statuses();
    const all = tickets.list();

    const progress = parentProgress(all, statuses);
    if (progress.length > 0) {
      this.section(el, "Parents");
      for (const p of progress) this.parentRow(el, p);
    }

    // Running tickets are already started, so they are no longer in `queue()`; list them first.
    const live = [...running.keys()].flatMap((id) => (tickets.get(id) ? [tickets.get(id)!] : []));
    const queued = new Set(items.map((t) => t.id));
    this.section(el, "Ready for agent");
    if (items.length === 0 && live.length === 0) {
      el.createDiv({
        cls: "kh-term-queue-empty",
        text: "Nothing ready. A ticket appears here when it has the agent-ready label (accept it in Triage with r), is not started, and every blocker is done.",
      });
    }
    for (const t of live) this.row(el, t, true, running.get(t.id));
    for (const t of items) this.row(el, t, true, running.get(t.id));

    const rest = (cat: string) =>
      all.filter((t) => !queued.has(t.id) && !running.has(t.id) && categoryOf(t.status, statuses) === cat);
    const todo = [...rest("unstarted"), ...rest("backlog")];
    const triage = rest("triage");
    if (todo.length > 0) {
      this.section(el, "Todo");
      for (const t of todo) this.row(el, t, false);
    }
    if (triage.length > 0) {
      this.section(el, "Triage");
      for (const t of triage) this.row(el, t, false);
    }
  }

  private section(parent: HTMLElement, text: string): void {
    parent.createEl("h5", { cls: "kh-term-queue-section", text });
  }

  private parentRow(parent: HTMLElement, p: ParentProgress): void {
    const row = parent.createDiv({ cls: "kh-term-queue-parent", attr: { "data-kh-parent-id": p.parent.id } });
    const top = row.createDiv({ cls: "kh-term-queue-top" });
    top.createSpan({ cls: "kh-term-queue-id", text: p.parent.id });
    top.createSpan({ cls: "kh-term-queue-name", text: `${p.parent.title} · ${p.percent}%` });
    const bar = row.createDiv({ cls: "kh-term-queue-bar" });
    bar.createDiv({ cls: "kh-term-queue-bar-fill" }).style.width = `${p.percent}%`;
    row.createDiv({
      cls: "kh-term-queue-meta",
      text: p.current ? `${p.done}/${p.total} done · ${p.current.title}` : `${p.done}/${p.total} done`,
    });
    row.onclick = (e) => this.hub.services.get("tickets")?.open?.(p.parent.id, e.ctrlKey || e.metaKey);
  }

  /** `ready` rows launch on one click; others (todo/triage lack the agent-ready human gate) need a second click to confirm. */
  private row(parent: HTMLElement, t: Issue, ready: boolean, sessionId?: string): void {
    const tickets = this.hub.services.get("tickets");
    const row = parent.createDiv({ cls: "kh-term-queue-item", attr: { "data-kh-queue-id": t.id } });
    const top = row.createDiv({ cls: "kh-term-queue-top" });
    top.createSpan({ cls: "kh-term-queue-id", text: t.id });
    top.createSpan({ cls: "kh-term-queue-chip", text: effectiveType(t) });
    const attn = this.hub.services.get("attention")?.get(t.id);
    if (attn) {
      row.addClass("is-attention");
      const badge = top.createEl("button", { cls: "kh-term-attention", text: attn.reason, attr: { title: "Needs attention: click to focus the session", "data-kh-attention": attn.reason } });
      badge.onclick = (e) => {
        e.stopPropagation();
        void this.focus(attn.sessionId);
      };
    }
    row.createDiv({ cls: "kh-term-queue-name", text: t.title });
    const meta = row.createDiv({ cls: "kh-term-queue-meta" });
    const repo = tickets?.repoOf(t.id);
    meta.createSpan({ text: repo ?? "no repo" });
    meta.createSpan({ text: t.model ?? "default model" });
    if (sessionId) {
      const b = row.createEl("button", { cls: "kh-term-queue-running", text: "running" });
      b.onclick = () => void this.focus(sessionId);
      row.onclick = () => void this.focus(sessionId);
      return;
    }
    const label = ready ? "Launch" : "Launch (not agent-ready)";
    const btn = row.createEl("button", { cls: ready ? "mod-cta kh-term-queue-launch" : "kh-term-queue-launch", text: label, attr: { title: "Shift-click to choose the account" } });
    let armed = false;
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!ready && !armed) {
        armed = true;
        btn.setText("Click again to confirm");
        window.setTimeout(() => { armed = false; btn.setText(label); }, 4000);
        return;
      }
      btn.disabled = true;
      try {
        const r = await this.launcher()?.launch(t.id, { pick: e.shiftKey });
        if (!r) new Notice("kyle-hub: terminal sessions are unavailable.");
        else if (!r.ok) new Notice(`kyle-hub: ${r.message}`);
        else await this.focus(r.sessionId);
      } catch (err) {
        new Notice(`kyle-hub: launch failed: ${(err as Error).message}`);
      } finally {
        btn.disabled = false;
        this.schedule();
      }
    };
  }
}
