import { ItemView, Menu, Modal, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type { GapsReport } from "../../../core/domain/gaps";
import { COLORS } from "./colors";
import { gapRows } from "./gapsRows";
import type TermHost from "./main";
import type { Session, SessionManager } from "./session-manager";
import { formatAge } from "./title";
import { runningCount, SUBAGENT_FADE_MS, type AgentState } from "./agent-state";
import { applyDrop, ids as layoutIds, nextExpand, remove as removeFromLayout, resolveZone, type ExpandLevel, type Layout, type Zone } from "./tile-layout";

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  working: "Working",
  "needs-input": "Needs input",
  finished: "Finished",
  exited: "Exited",
};

export const VIEW_TYPE = "kh-term-view";

const QUEUE_TABS: readonly (readonly [QueueTabKey, string])[] = [["triage", "Triage"], ["todo", "Todo"], ["gaps", "Gaps"]];
type QueueTabKey = "triage" | "todo" | "gaps";

class ConfirmModal extends Modal {
  constructor(app: TermHost["app"], private message: string, private onYes: () => void) {
    super(app);
  }
  override onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const ok = row.createEl("button", { text: "Kill", cls: "mod-warning" });
    ok.onclick = () => { this.close(); this.onYes(); };
  }
  override onClose(): void { this.contentEl.empty(); }
}

export class TermView extends ItemView {
  private mgr: SessionManager | null = null;
  private unsub: (() => void) | null = null;
  private unsubMute: (() => void) | null = null;
  private unsubRetro: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private sidebar!: HTMLElement;
  private list!: HTMLElement;
  private area!: HTMLElement;
  private queuePanel!: HTMLElement;
  private queueBody!: HTMLElement;
  /** Tears down the selected tab's content: the tickets React root, or the Gaps subscription. */
  private unmountQueue: (() => void) | null = null;
  private wrap: HTMLElement | null = null;
  private renamingId: string | null = null;
  private dragId: string | null = null;
  private subsClosed = new Set<string>();
  /** Columns of stacked session ids. Not persisted; seeded from the active session. */
  private layout: Layout = [];
  private expanded: { id: string; level: 1 | 2 } | null = null;
  private lastActive: string | null = null;
  private tileSig = "";
  private tiles: { id: string; el: HTMLElement; titleEl?: HTMLElement; titleText?: HTMLElement; expandBtn?: HTMLElement }[] = [];
  private dropEl: HTMLElement | null = null;
  private dropTarget: { id: string; zone: Zone } | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: TermHost) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Terminal"; }
  override getIcon(): string { return "terminal"; }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("kh-term-root");

    const mgr = this.plugin.getSessions();
    if (typeof mgr === "string") {
      root.createDiv({ cls: "kh-term-message", text: mgr });
      return;
    }
    this.mgr = mgr;
    const settings = this.plugin.settings;

    this.sidebar = root.createDiv({ cls: "kh-term-sidebar" });
    const resizer = root.createDiv({ cls: "kh-term-resizer" });
    const wrap = root.createDiv({ cls: "kh-term-term-wrap" });
    wrap.createDiv({ cls: "kh-term-bg-img" });
    wrap.createDiv({ cls: "kh-term-bg-dim" });
    this.area = wrap.createDiv({ cls: "kh-term-term-area" });
    this.wrap = wrap;
    // Accept drops from the explorer (and plain text) onto the terminal.
    this.dropEl = wrap.createDiv({ cls: "kh-term-dropzone" });
    this.area.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (this.dragId) this.showDrop(e);
    });
    this.area.addEventListener("dragleave", (e) => {
      if (!this.area.contains(e.relatedTarget as Node | null)) this.hideDrop();
    });
    this.area.addEventListener("drop", (e) => {
      e.preventDefault();
      if (this.dragId) { this.commitDrop(); return; }
      e.stopPropagation();
      const s = this.mgr?.active;
      if (!s || s.status !== "running") return;
      const text = this.plugin.resolveDrop(e.dataTransfer, s.cwd);
      if (text) this.mgr?.sendText(s.id, text);
    }, true);
    this.applyBackground(this.plugin.bgVars(true));
    this.buildQueuePanel(root);

    const header = this.sidebar.createDiv({ cls: "kh-term-header" });
    const newClaude = header.createEl("button", { text: "New Session", cls: "kh-term-btn-new mod-cta" });
    newClaude.onclick = () => void this.plugin.newClaude();
    newClaude.oncontextmenu = (e) => { e.preventDefault(); this.plugin.showNewSessionMenu(e); };
    const plus = header.createEl("button", { text: "+", cls: "kh-term-btn-plus", attr: { "aria-label": "New terminal" } });
    plus.onclick = () => void this.plugin.newShell();
    const mute = header.createEl("button", { cls: "kh-term-btn-mute" });
    mute.onclick = () => this.plugin.setMuted(!settings.sounds.muted);
    const syncMute = () => {
      const m = settings.sounds.muted;
      setIcon(mute, m ? "volume-x" : "volume-2");
      mute.setAttribute("aria-label", m ? "Unmute sounds" : "Mute sounds");
      mute.toggleClass("is-muted", m);
    };
    syncMute();
    this.unsubMute = this.plugin.onMuteChange(syncMute);
    const collapse = header.createEl("button", { cls: "kh-term-btn-collapse", attr: { "aria-label": "Collapse sidebar" } });
    collapse.onclick = () => {
      settings.sidebarCollapsed = !settings.sidebarCollapsed;
      void this.plugin.saveSettings();
      this.applySidebar();
    };
    this.buildRetroPanel();
    this.list = this.sidebar.createDiv({ cls: "kh-term-list" });

    resizer.addEventListener("pointerdown", (e) => {
      if (settings.sidebarCollapsed) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = settings.sidebarWidth;
      const move = (ev: PointerEvent) => {
        settings.sidebarWidth = Math.max(140, Math.min(600, startW + ev.clientX - startX));
        this.applySidebar();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        void this.plugin.saveSettings();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    this.applySidebar();
    this.unsub = mgr.onChange(() => this.refresh());
    this.ro = new ResizeObserver(() => this.fitTiles());
    this.ro.observe(this.area);
    this.registerInterval(window.setInterval(() => this.renderList(), 15000));

    if (mgr.list().length === 0) await this.plugin.newShell();
    else this.refresh();
  }

  /** Right-hand sidebar, same width as the session sidebar and collapsible. Tabs: Triage / Todo (tickets), Gaps (brain). */
  private buildQueuePanel(root: HTMLElement): void {
    this.queuePanel = root.createDiv({ cls: "kh-term-queue-panel" });
    const header = this.queuePanel.createDiv({ cls: "kh-term-header kh-term-queue-header" });
    const tabs = header.createDiv({ cls: "kh-term-queue-tabs", attr: { role: "tablist" } });
    for (const [key, label] of QUEUE_TABS) {
      const tab = tabs.createEl("button", { text: label, cls: "kh-term-queue-tab", attr: { role: "tab", "data-tab": key } });
      tab.onclick = () => this.selectQueueTab(key);
    }
    const toggle = header.createEl("button", { cls: "kh-term-btn-collapse kh-term-queue-toggle" });
    toggle.onclick = () => {
      this.plugin.settings.queueCollapsed = !this.plugin.settings.queueCollapsed;
      void this.plugin.saveSettings();
      this.applyQueue();
    };
    this.queueBody = this.queuePanel.createDiv({ cls: "kh-term-queue-body" });
    this.mountQueueBody();
    this.applyQueue();
  }

  private selectQueueTab(tab: QueueTabKey): void {
    this.plugin.settings.queueTab = tab;
    void this.plugin.saveSettings();
    this.mountQueueBody();
  }

  /** Mounts the selected tab. Each tab shows a short message when its source module is off. */
  private mountQueueBody(): void {
    this.unmountQueue?.();
    this.unmountQueue = null;
    this.queueBody.empty();
    const s = this.plugin.settings;
    const tab: QueueTabKey = QUEUE_TABS.some(([k]) => k === s.queueTab) ? s.queueTab : "todo";
    this.queuePanel.querySelectorAll<HTMLElement>(".kh-term-queue-tab").forEach((el) => {
      const on = el.dataset.tab === tab;
      el.toggleClass("is-active", on);
      el.setAttribute("aria-selected", String(on));
    });
    if (tab === "gaps") {
      const gaps = this.plugin.hub.services.get("gaps");
      if (!gaps) {
        this.queueBody.createDiv({ cls: "kh-term-message", text: "Brain module is disabled. Turn it on in the kyle-hub settings to see gaps." });
        return;
      }
      const list = this.queueBody.createDiv({ cls: "kh-term-gaps" });
      const render = (): void => this.renderGaps(list, gaps.read());
      render();
      this.unmountQueue = gaps.onChange(render);
      return;
    }
    const svc = this.plugin.hub.services.get("queuePanel");
    if (svc) this.unmountQueue = svc.mount(this.queueBody, tab);
    else this.queueBody.createDiv({ cls: "kh-term-message", text: "Tickets module is disabled. Turn it on in the kyle-hub settings to see Triage and Todo." });
  }

  /** Worst-first notes under the cutoff. Click opens the note in a new tab, keeping the terminal view. */
  private renderGaps(list: HTMLElement, report: GapsReport | undefined): void {
    list.empty();
    if (!report) {
      list.createDiv({ cls: "kh-term-message", text: "No gaps data yet. Run `kh maintain`." });
      return;
    }
    const rows = gapRows(report);
    if (rows.length === 0) {
      list.createDiv({ cls: "kh-term-message", text: "No notes under the cutoff." });
      return;
    }
    for (const row of rows) {
      const item = list.createDiv({ cls: "kh-term-gap", attr: { role: "button", tabindex: "0", title: row.path } });
      item.onclick = () => void this.app.workspace.openLinkText(row.path, "", "tab");
      const top = item.createDiv({ cls: "kh-term-gap-top" });
      top.createSpan({ cls: "kh-term-gap-grade", text: row.grade });
      top.createSpan({ cls: "kh-term-gap-name", text: row.name });
      item.createDiv({ cls: "kh-term-gap-reason", text: row.reason });
    }
  }

  private applyQueue(): void {
    const s = this.plugin.settings;
    this.queuePanel.toggleClass("kh-term-collapsed", s.queueCollapsed);
    this.queuePanel.style.width = s.queueCollapsed ? "" : `${s.sidebarWidth}px`;
    const btn = this.queuePanel.querySelector<HTMLElement>(".kh-term-queue-toggle");
    if (btn) {
      setIcon(btn, s.queueCollapsed ? "chevrons-left" : "chevrons-right");
      btn.setAttribute("aria-label", s.queueCollapsed ? "Expand panel" : "Collapse panel");
    }
    const id = this.mgr?.active?.id;
    if (id) window.setTimeout(() => this.mgr?.term(id)?.fit(), 0);
  }

  /** Set the background CSS variables; layers read them, so sliders are smooth. */
  applyBackground(vars: Record<string, string>): void {
    if (!this.wrap) return;
    for (const [k, v] of Object.entries(vars)) this.wrap.style.setProperty(k, v);
  }

  /** Perform Retro button with the watermark and the sessions-since nudge. */
  private buildRetroPanel(): void {
    const panel = this.sidebar.createDiv({ cls: "kh-term-retro" });
    const btn = panel.createEl("button", { text: "Perform Retro", cls: "kh-term-retro-btn", attr: { "data-kh-retro": "perform" } });
    const last = panel.createDiv({ cls: "kh-term-retro-last", attr: { "data-kh-retro": "last" } });
    const since = panel.createDiv({ cls: "kh-term-retro-since", attr: { "data-kh-retro": "since" } });
    const svc = () => this.plugin.retroService();
    const refresh = async (): Promise<void> => {
      try {
        const s = await svc().status();
        last.setText(`Last retro: ${s.lastRetroAt === undefined ? "never" : Date.now() - Date.parse(s.lastRetroAt) < 60000 ? "just now" : `${formatAge(Date.now() - Date.parse(s.lastRetroAt))} ago`}`);
        since.setText(`${s.sessionsSince} sessions since last retro`);
        since.toggleClass("is-nudge", s.sessionsSince >= s.nudgeAt);
      } catch {
        last.setText("Last retro: unavailable");
        since.setText("");
      }
    };
    btn.onclick = () => {
      btn.disabled = true;
      void svc()
        .perform()
        .then((r) => {
          const lines = r.created.map((c) => `${c.id} (${c.type}): ${c.title}`);
          new Notice(
            `Retro done. ${r.created.length} new ticket${r.created.length === 1 ? "" : "s"}${r.seenAgain.length > 0 ? `, ${r.seenAgain.length} seen again` : ""}.${lines.length > 0 ? "\n" + lines.join("\n") : ""}`,
            10000,
          );
        })
        .catch((e: unknown) => new Notice(`Retro failed: ${(e as Error).message}`, 10000))
        .finally(() => {
          btn.disabled = false;
          void refresh();
        });
    };
    void refresh();
    const off = svc().subscribe(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 60000);
    this.unsubRetro = () => {
      off();
      window.clearInterval(timer);
    };
  }

  override async onClose(): Promise<void> {
    this.unsubRetro?.();
    this.unsubRetro = null;
    this.unmountQueue?.();
    this.unmountQueue = null;
    // Sessions belong to the plugin: just detach, never kill.
    this.unsub?.();
    this.unsub = null;
    this.unsubMute?.();
    this.unsubMute = null;
    this.ro?.disconnect();
    this.ro = null;
    this.area?.empty();
    this.tileSig = "";
    this.tiles = [];
    this.layout = [];
    this.expanded = null;
    this.lastActive = null;
    this.dragId = null;
    this.dropEl = null;
    this.mgr = null;
  }

  private applySidebar(): void {
    const s = this.plugin.settings;
    this.sidebar.toggleClass("kh-term-collapsed", s.sidebarCollapsed);
    this.sidebar.style.width = s.sidebarCollapsed ? "" : `${s.sidebarWidth}px`;
    if (this.queuePanel && !s.queueCollapsed) this.queuePanel.style.width = `${s.sidebarWidth}px`;
    const btn = this.sidebar.querySelector<HTMLElement>(".kh-term-btn-collapse");
    if (btn) setIcon(btn, s.sidebarCollapsed ? "chevrons-right" : "chevrons-left");
    const id = this.mgr?.active?.id;
    if (id) window.setTimeout(() => this.mgr?.term(id)?.fit(), 0);
  }

  private refresh(): void {
    if (!this.mgr) return;
    if (this.renamingId === null) this.renderList();
    const mgr = this.mgr;
    this.reconcile();
    const sig = `${JSON.stringify(this.layout)}|${this.expanded?.id ?? ""}:${this.expanded?.level ?? 0}`;
    if (sig !== this.tileSig) {
      this.tileSig = sig;
      this.buildTiles();
      window.setTimeout(() => { this.fitTiles(); const a = mgr.active; if (a) mgr.term(a.id)?.focus(); }, 0);
    }
    this.paintTiles();
  }

  /** Drops closed sessions, makes sure the active session is visible (replacing the previous active tile), seeds an empty layout. */
  private reconcile(): void {
    const mgr = this.mgr!;
    const live = new Set(mgr.list().map((s) => s.id));
    const active = mgr.active?.id;
    const before = layoutIds(this.layout);
    const closedActive = this.lastActive !== null && !live.has(this.lastActive);
    let l: Layout = this.layout.map((c) => c.map((id) => (closedActive && active && id === this.lastActive && !before.includes(active) ? active : id)));
    l = l.map((c) => c.filter((id) => live.has(id))).filter((c) => c.length > 0);
    if (active && !layoutIds(l).includes(active)) {
      if (l.length === 0) l = [[active]];
      else {
        const rep = this.lastActive && layoutIds(l).includes(this.lastActive) ? this.lastActive : l[0]![0]!;
        l = l.map((c) => c.map((id) => (id === rep ? active : id)));
      }
    }
    this.lastActive = active ?? null;
    this.layout = l;
    const ex = this.expanded;
    if (ex && (ex.id !== active || !layoutIds(l).includes(ex.id) || layoutIds(l).length < 2)) this.expanded = null;
  }

  private buildTiles(): void {
    const mgr = this.mgr!;
    const ex = this.expanded;
    this.area.empty();
    const multi = layoutIds(this.layout).length > 1;
    this.area.className = `kh-term-term-area kh-term-grid${multi ? "" : " is-solo"}`;
    this.tiles = [];
    if (this.layout.length === 0) {
      this.area.createDiv({ cls: "kh-term-message kh-term-empty", text: "No sessions. Use New Session or + to start one." });
      return;
    }
    for (const col of this.layout) {
      const colEl = this.area.createDiv({ cls: "kh-term-col" });
      const hasEx = !!ex && col.includes(ex.id);
      if (ex?.level === 2 && !hasEx) colEl.addClass("is-hidden");
      for (const id of col) {
        const tile = colEl.createDiv({ cls: "kh-term-tile" });
        if (hasEx && id !== ex!.id) tile.addClass("is-hidden");
        let titleEl: HTMLElement | undefined;
        let titleText: HTMLElement | undefined;
        let expandBtn: HTMLElement | undefined;
        if (multi) {
          titleEl = tile.createDiv({ cls: "kh-term-tile-title" });
          titleEl.draggable = true;
          titleText = titleEl.createSpan({ cls: "kh-term-tile-name" });
          expandBtn = titleEl.createEl("button", { cls: "kh-term-tile-btn" });
          expandBtn.onclick = (e) => { e.stopPropagation(); this.toggleExpand(id); };
          const x = titleEl.createEl("button", { cls: "kh-term-tile-btn", attr: { "aria-label": "Remove from view" } });
          setIcon(x, "x");
          x.onclick = (e) => { e.stopPropagation(); this.removeTile(id); };
          for (const b of [expandBtn, x]) b.ondblclick = (e) => e.stopPropagation();
          titleEl.ondblclick = () => this.toggleExpand(id);
          titleEl.addEventListener("dragstart", (e) => {
            this.dragId = id;
            e.dataTransfer?.setData("text/plain", id);
          });
          titleEl.addEventListener("dragend", () => { this.dragId = null; this.hideDrop(); });
        }
        const body = tile.createDiv({ cls: "kh-term-tile-body" });
        mgr.term(id)?.attach(body);
        tile.addEventListener("pointerdown", () => {
          mgr.setActive(id);
          mgr.term(id)?.focus();
        }, true);
        this.tiles.push({ id, el: tile, titleEl, titleText, expandBtn });
      }
    }
  }

  /** Blue outline = agent needs you, green = finished and not yet viewed; the focused tile gets a faint edge. */
  private paintTiles(): void {
    const mgr = this.mgr;
    if (!mgr) return;
    const active = mgr.active?.id;
    for (const t of this.tiles) {
      const s = mgr.get(t.id);
      if (!s) continue;
      const state = s.status === "running" ? s.agent.state : "exited";
      t.el.toggleClass("is-needs", state === "needs-input");
      t.el.toggleClass("is-done", state === "finished");
      t.el.toggleClass("is-focused", t.id === active);
      t.titleText?.setText(mgr.title(s));
      t.titleEl?.toggleClass("has-tag", !!s.color);
      t.titleEl?.style.setProperty("--kh-term-tag", s.color ?? null);
      if (t.expandBtn) {
        const open = this.expanded?.id === t.id;
        setIcon(t.expandBtn, open ? "minimize-2" : "maximize-2");
        t.expandBtn.setAttribute("aria-label", open ? "Restore" : "Expand (double-click header)");
      }
    }
  }

  private fitTiles(): void {
    for (const t of this.tiles) this.mgr?.term(t.id)?.fit();
  }

  /** Normal -> fill its column (when stacked) -> fill everything -> normal. */
  private toggleExpand(id: string): void {
    const mgr = this.mgr;
    if (!mgr) return;
    mgr.setActive(id);
    const cur: ExpandLevel = this.expanded?.id === id ? this.expanded.level : 0;
    const n = nextExpand(this.layout, id, cur);
    this.expanded = n === 0 ? null : { id, level: n };
    this.refresh();
  }

  private removeTile(id: string): void {
    const next = removeFromLayout(this.layout, id);
    if (next.length === 0) return;
    this.layout = next;
    this.expanded = null;
    const mgr = this.mgr;
    if (mgr?.active?.id === id) mgr.setActive(layoutIds(next)[0]!);
    this.refresh();
  }

  private tileAt(x: number, y: number): { id: string; rect: DOMRect } | undefined {
    for (const t of this.tiles) {
      const r = t.el.getBoundingClientRect();
      if (r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id: t.id, rect: r };
    }
    return undefined;
  }

  /** While a session is held over the terminal area: highlight where it would land (edge = split, middle = replace). */
  private showDrop(e: DragEvent): void {
    const dragged = this.dragId;
    const t = dragged ? this.tileAt(e.clientX, e.clientY) : undefined;
    if (!dragged || !t || t.id === dragged || !this.dropEl) { this.hideDrop(); return; }
    const { rect: r } = t;
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const want: Zone = fx < 0.22 ? "left" : fx > 0.78 ? "right" : fy > 0.7 ? "below" : fy < 0.3 ? "above" : "replace";
    const zone = resolveZone(this.layout, dragged, t.id, want);
    this.dropTarget = { id: t.id, zone };
    const w = this.dropEl.parentElement!.getBoundingClientRect();
    let { left, top, width, height } = r;
    if (zone === "left") width /= 2;
    else if (zone === "right") { left += width / 2; width /= 2; }
    else if (zone === "above") height /= 2;
    else if (zone === "below") { top += height / 2; height /= 2; }
    Object.assign(this.dropEl.style, { display: "block", left: `${left - w.left}px`, top: `${top - w.top}px`, width: `${width}px`, height: `${height}px` });
  }

  private hideDrop(): void {
    this.dropTarget = null;
    if (this.dropEl) this.dropEl.style.display = "none";
  }

  private commitDrop(): void {
    const dragged = this.dragId;
    const target = this.dropTarget;
    this.dragId = null;
    this.hideDrop();
    if (!dragged || !target) return;
    const next = applyDrop(this.layout, dragged, target.id, target.zone);
    if (!next) return;
    this.layout = next;
    this.expanded = null;
    this.mgr?.setActive(dragged);
    this.refresh();
  }

  private renderList(): void {
    const mgr = this.mgr;
    if (!mgr || this.renamingId !== null) return;
    const scroll = this.list.scrollTop;
    this.list.empty();
    const now = Date.now();
    for (const s of mgr.list()) {
      const row = this.list.createDiv({ cls: "kh-term-row" });
      if (mgr.active?.id === s.id) row.addClass("is-active");
      if (s.status !== "running") row.addClass("is-exited");
      row.draggable = true;
      const stripe = row.createDiv({ cls: "kh-term-stripe" });
      if (s.color) stripe.style.background = s.color;
      const main = row.createDiv({ cls: "kh-term-main" });

      const top = main.createDiv({ cls: "kh-term-top" });
      const state = s.status === "running" ? s.agent.state : "exited";
      const stateLabel = s.status === "stopped" ? "Stopped" : STATE_LABEL[state];
      top.createDiv({ cls: `kh-term-light kh-term-light-${state}`, attr: { "aria-label": stateLabel, title: stateLabel } });
      const title = top.createDiv({ cls: "kh-term-title", text: mgr.title(s) });
      if (s.manualTitle) setIcon(top.createDiv({ cls: "kh-term-pin", attr: { "aria-label": "Named manually" } }), "pin");
      const subs = s.agent.subAgents.filter((a) => a.status === "running" || now - (a.endedAt ?? now) < SUBAGENT_FADE_MS);
      const running = runningCount(s.agent);
      if (subs.length > 0) {
        const badge = top.createSpan({ cls: "kh-term-count", text: `⚙ ${running}`, attr: { "aria-label": "Sub-agents (click to collapse)" } });
        badge.onclick = (e) => {
          e.stopPropagation();
          if (!this.subsClosed.delete(s.id)) this.subsClosed.add(s.id);
          this.renderList();
        };
      }
      top.createDiv({ cls: "kh-term-age", text: formatAge(now - s.lastOutputAt) });
      if (s.status === "running" && s.agent.activity && (state === "working" || state === "needs-input")) {
        main.createDiv({ cls: "kh-term-activity", text: s.agent.activity });
      }
      if (subs.length > 0 && !this.subsClosed.has(s.id)) {
        const ul = main.createDiv({ cls: "kh-term-subs" });
        for (const a of subs) {
          const line = ul.createDiv({ cls: `kh-term-sub is-${a.status}` });
          if (a.status === "done") line.style.animationDelay = `${SUBAGENT_FADE_MS * 0.7 - (now - (a.endedAt ?? now))}ms`;
          line.createSpan({ cls: "kh-term-sub-mark", text: a.status === "done" ? "✓" : "" });
          line.createSpan({ cls: "kh-term-sub-text", text: [a.type, a.description].filter(Boolean).join(": ") || "sub-agent" });
        }
      }

      if (s.status !== "running") {
        const ex = main.createDiv({ cls: "kh-term-exit" });
        ex.createSpan({ text: s.status === "stopped" ? "stopped" : `exit ${s.exitCode ?? "?"}`, cls: "kh-term-exit-code" });
        if (mgr.canResume(s)) {
          const resume = ex.createEl("button", { text: "Resume", cls: "mod-cta" });
          resume.onclick = (e) => { e.stopPropagation(); mgr.resume(s.id); };
        } else if (s.status === "stopped" && s.kind === "claude") {
          const why = "Can't resume: no Claude session id was captured. Run \"kyle-hub: Install hooks\", then start a new session.";
          const resume = ex.createEl("button", { text: "Resume", cls: "is-disabled", attr: { "aria-label": why } });
          resume.onclick = (e) => { e.stopPropagation(); new Notice(why, 8000); };
        }
        const restart = ex.createEl("button", { text: "Restart" });
        restart.onclick = (e) => { e.stopPropagation(); mgr.restart(s.id); };
        const close = ex.createEl("button", { text: "Close" });
        close.onclick = (e) => { e.stopPropagation(); mgr.close(s.id); };
      }

      row.onclick = () => mgr.setActive(s.id);
      title.ondblclick = (e) => { e.stopPropagation(); this.startRename(s, title); };
      row.oncontextmenu = (e) => { e.preventDefault(); this.contextMenu(s, e, title); };

      row.addEventListener("dragstart", (e) => {
        this.dragId = s.id;
        e.dataTransfer?.setData("text/plain", s.id);
      });
      row.addEventListener("dragend", () => {
        this.dragId = null;
        this.list.querySelectorAll(".kh-term-drop").forEach((n) => n.removeClass("kh-term-drop"));
        this.hideDrop();
      });
      row.addEventListener("dragover", (e) => {
        if (!this.dragId) return;
        e.preventDefault();
        row.addClass("kh-term-drop");
      });
      row.addEventListener("dragleave", () => row.removeClass("kh-term-drop"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const id = this.dragId;
        this.dragId = null;
        if (id) mgr.move(id, mgr.list().findIndex((x) => x.id === s.id));
      });
    }
    this.list.scrollTop = scroll;
  }

  private startRename(s: Session, titleEl: HTMLElement): void {
    const mgr = this.mgr;
    if (!mgr || this.renamingId !== null) return;
    this.renamingId = s.id;
    const input = createEl("input", { type: "text", cls: "kh-term-rename", value: s.manualTitle ?? mgr.title(s) });
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.renamingId = null;
      if (commit) mgr.rename(s.id, input.value);
      else this.renderList();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    };
    input.onblur = () => finish(true);
    input.onclick = (e) => e.stopPropagation();
    input.ondblclick = (e) => e.stopPropagation();
  }

  private contextMenu(s: Session, e: MouseEvent, titleEl: HTMLElement): void {
    const mgr = this.mgr;
    if (!mgr) return;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Rename").setIcon("pencil").onClick(() => this.startRename(s, titleEl)));
    menu.addItem((i) =>
      i.setTitle("Colour tag").setIcon("palette").onClick(() => {
        const sub = new Menu();
        for (const [name, hex] of Object.entries(COLORS)) {
          sub.addItem((c) => c.setTitle(`${s.color === hex ? "● " : ""}${name}`).onClick(() => mgr.setColor(s.id, hex)));
        }
        sub.addItem((c) => c.setTitle("None").onClick(() => mgr.setColor(s.id, undefined)));
        sub.showAtPosition({ x: e.clientX, y: e.clientY });
      }),
    );
    if (mgr.canResume(s)) menu.addItem((i) => i.setTitle("Resume").setIcon("play").onClick(() => mgr.resume(s.id)));
    menu.addItem((i) => i.setTitle("Restart").setIcon("refresh-cw").onClick(() => mgr.restart(s.id)));
    menu.addItem((i) =>
      i.setTitle("Kill").setIcon("skull").setDisabled(s.status !== "running").onClick(() => {
        new ConfirmModal(this.app, `Kill "${mgr.title(s)}"? The running process will be terminated.`, () => mgr.kill(s.id)).open();
      }),
    );
    menu.addItem((i) =>
      i.setTitle("Copy working folder").setIcon("copy").onClick(() => {
        void navigator.clipboard.writeText(s.cwd).then(() => new Notice("Copied working folder"));
      }),
    );
    menu.showAtMouseEvent(e);
  }
}
