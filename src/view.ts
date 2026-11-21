import { ItemView, Menu, Modal, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import type KyleTermPlugin from "./main";
import type { Session, SessionManager } from "./session-manager";
import { formatAge } from "./title";
import { runningCount, SUBAGENT_FADE_MS, type AgentState } from "./agent-state";

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  working: "Working",
  "needs-input": "Needs input",
  finished: "Finished",
  exited: "Exited",
};

export const VIEW_TYPE = "kyle-term-view";

const COLORS: Record<string, string> = {
  Red: "#e5534b",
  Orange: "#e08a2c",
  Yellow: "#d4b106",
  Green: "#3fb950",
  Blue: "#4c8dff",
  Purple: "#a371f7",
};

class ConfirmModal extends Modal {
  constructor(app: KyleTermPlugin["app"], private message: string, private onYes: () => void) {
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

export class KyleTermView extends ItemView {
  private mgr: SessionManager | null = null;
  private unsub: (() => void) | null = null;
  private unsubMute: (() => void) | null = null;
  private ro: ResizeObserver | null = null;
  private sidebar!: HTMLElement;
  private list!: HTMLElement;
  private area!: HTMLElement;
  private wrap: HTMLElement | null = null;
  private mountedId: string | null = null;
  private renamingId: string | null = null;
  private dragId: string | null = null;
  private subsClosed = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: KyleTermPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "kyle-term"; }
  override getIcon(): string { return "terminal"; }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("kyle-term-root");

    const mgr = this.plugin.getSessions();
    if (typeof mgr === "string") {
      root.createDiv({ cls: "kyle-term-message", text: mgr });
      return;
    }
    this.mgr = mgr;
    const settings = this.plugin.settings;

    this.sidebar = root.createDiv({ cls: "kt-sidebar" });
    const resizer = root.createDiv({ cls: "kt-resizer" });
    const wrap = root.createDiv({ cls: "kt-term-wrap" });
    wrap.createDiv({ cls: "kt-bg-img" });
    wrap.createDiv({ cls: "kt-bg-dim" });
    this.area = wrap.createDiv({ cls: "kt-term-area" });
    this.wrap = wrap;
    this.applyBackground(this.plugin.bgVars(true));

    const header = this.sidebar.createDiv({ cls: "kt-header" });
    const newClaude = header.createEl("button", { text: "New Session", cls: "kt-btn-new mod-cta" });
    newClaude.onclick = () => void this.plugin.newClaude();
    const plus = header.createEl("button", { text: "+", cls: "kt-btn-plus", attr: { "aria-label": "New terminal" } });
    plus.onclick = () => void this.plugin.newShell();
    const mute = header.createEl("button", { cls: "kt-btn-mute" });
    mute.onclick = () => this.plugin.setMuted(!settings.sounds.muted);
    const syncMute = () => {
      const m = settings.sounds.muted;
      setIcon(mute, m ? "volume-x" : "volume-2");
      mute.setAttribute("aria-label", m ? "Unmute sounds" : "Mute sounds");
      mute.toggleClass("is-muted", m);
    };
    syncMute();
    this.unsubMute = this.plugin.onMuteChange(syncMute);
    const collapse = header.createEl("button", { cls: "kt-btn-collapse", attr: { "aria-label": "Collapse sidebar" } });
    collapse.onclick = () => {
      settings.sidebarCollapsed = !settings.sidebarCollapsed;
      void this.plugin.saveSettings();
      this.applySidebar();
    };
    this.list = this.sidebar.createDiv({ cls: "kt-list" });

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
    this.ro = new ResizeObserver(() => this.mgr?.active && this.mgr.term(this.mgr.active.id)?.fit());
    this.ro.observe(this.area);
    this.registerInterval(window.setInterval(() => this.renderList(), 15000));

    if (mgr.list().length === 0) await this.plugin.newShell();
    else this.refresh();
  }

  /** Set the background CSS variables; layers read them, so sliders are smooth. */
  applyBackground(vars: Record<string, string>): void {
    if (!this.wrap) return;
    for (const [k, v] of Object.entries(vars)) this.wrap.style.setProperty(k, v);
  }

  override async onClose(): Promise<void> {
    // Sessions belong to the plugin: just detach, never kill.
    this.unsub?.();
    this.unsub = null;
    this.unsubMute?.();
    this.unsubMute = null;
    this.ro?.disconnect();
    this.ro = null;
    this.area?.empty();
    this.mountedId = null;
    this.mgr = null;
  }

  private applySidebar(): void {
    const s = this.plugin.settings;
    this.sidebar.toggleClass("kt-collapsed", s.sidebarCollapsed);
    this.sidebar.style.width = s.sidebarCollapsed ? "" : `${s.sidebarWidth}px`;
    const btn = this.sidebar.querySelector<HTMLElement>(".kt-btn-collapse");
    if (btn) setIcon(btn, s.sidebarCollapsed ? "chevrons-right" : "chevrons-left");
    const id = this.mgr?.active?.id;
    if (id) window.setTimeout(() => this.mgr?.term(id)?.fit(), 0);
  }

  private refresh(): void {
    if (!this.mgr) return;
    if (this.renamingId === null) this.renderList();
    const active = this.mgr.active;
    if (active?.id !== this.mountedId) {
      this.area.empty();
      this.mountedId = active?.id ?? null;
      if (active) {
        const t = this.mgr.term(active.id);
        t?.attach(this.area);
        window.setTimeout(() => { t?.fit(); t?.focus(); }, 0);
      } else {
        this.area.createDiv({ cls: "kyle-term-message kt-empty", text: "No sessions. Use New Session or + to start one." });
      }
    }
  }

  private renderList(): void {
    const mgr = this.mgr;
    if (!mgr || this.renamingId !== null) return;
    const scroll = this.list.scrollTop;
    this.list.empty();
    const now = Date.now();
    for (const s of mgr.list()) {
      const row = this.list.createDiv({ cls: "kt-row" });
      if (mgr.active?.id === s.id) row.addClass("is-active");
      if (s.status === "exited") row.addClass("is-exited");
      row.draggable = true;
      const stripe = row.createDiv({ cls: "kt-stripe" });
      if (s.color) stripe.style.background = s.color;
      const main = row.createDiv({ cls: "kt-main" });

      const top = main.createDiv({ cls: "kt-top" });
      const state = s.status === "exited" ? "exited" : s.agent.state;
      top.createDiv({ cls: `kt-light kt-light-${state}`, attr: { "aria-label": STATE_LABEL[state], title: STATE_LABEL[state] } });
      const title = top.createDiv({ cls: "kt-title", text: mgr.title(s) });
      if (s.manualTitle) setIcon(top.createDiv({ cls: "kt-pin", attr: { "aria-label": "Named manually" } }), "pin");
      const subs = s.agent.subAgents.filter((a) => a.status === "running" || now - (a.endedAt ?? now) < SUBAGENT_FADE_MS);
      const running = runningCount(s.agent);
      if (subs.length > 0) {
        const badge = top.createSpan({ cls: "kt-count", text: `⚙ ${running}`, attr: { "aria-label": "Sub-agents (click to collapse)" } });
        badge.onclick = (e) => {
          e.stopPropagation();
          if (!this.subsClosed.delete(s.id)) this.subsClosed.add(s.id);
          this.renderList();
        };
      }
      top.createDiv({ cls: "kt-age", text: formatAge(now - s.lastOutputAt) });
      if (s.status === "running" && s.agent.activity && (state === "working" || state === "needs-input")) {
        main.createDiv({ cls: "kt-activity", text: s.agent.activity });
      }
      if (subs.length > 0 && !this.subsClosed.has(s.id)) {
        const ul = main.createDiv({ cls: "kt-subs" });
        for (const a of subs) {
          const line = ul.createDiv({ cls: `kt-sub is-${a.status}` });
          if (a.status === "done") line.style.animationDelay = `${SUBAGENT_FADE_MS * 0.7 - (now - (a.endedAt ?? now))}ms`;
          line.createSpan({ cls: "kt-sub-mark", text: a.status === "done" ? "✓" : "" });
          line.createSpan({ cls: "kt-sub-text", text: [a.type, a.description].filter(Boolean).join(": ") || "sub-agent" });
        }
      }

      if (s.status === "exited") {
        const ex = main.createDiv({ cls: "kt-exit" });
        ex.createSpan({ text: `exit ${s.exitCode ?? "?"}`, cls: "kt-exit-code" });
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
        this.list.querySelectorAll(".kt-drop").forEach((n) => n.removeClass("kt-drop"));
      });
      row.addEventListener("dragover", (e) => {
        if (!this.dragId) return;
        e.preventDefault();
        row.addClass("kt-drop");
      });
      row.addEventListener("dragleave", () => row.removeClass("kt-drop"));
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
    const input = createEl("input", { type: "text", cls: "kt-rename", value: s.manualTitle ?? mgr.title(s) });
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
