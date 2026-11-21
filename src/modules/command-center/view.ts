import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Hub } from "../../core";
import { buildCommandCenterModel, loadCommandCenterData, SPARKLINE_HEIGHT, SPARKLINE_WIDTH, type CommandCenterModel, type CommandCenterReader, type Part, type Tile, type UsageRow } from "./model";

export const COMMAND_CENTER_VIEW_TYPE = "kh-command-center-view";
const REFRESH_MS = 60_000;

const BUS_EVENTS = [
  "ticket:created",
  "ticket:status-changed",
  "ticket:label-changed",
  "session:started",
  "session:ended",
  "session:needs-attention",
  "session:attention-cleared",
  "run:finished",
  "run:ingested",
  "retro:completed",
  "brain:health-changed",
  "usage:threshold",
] as const;

/** Read-only dashboard. Reads services through `reader()` (resolved per refresh, so a module switched off shows as disabled). */
export class CommandCenterView extends ItemView {
  private offs: (() => void)[] = [];
  private timer: number | null = null;
  private isOpen = false;
  private seq = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private hub: Hub,
    private reader: () => CommandCenterReader,
    private focusTicket: (ticketId: string) => Promise<void>,
  ) {
    super(leaf);
  }

  getViewType(): string { return COMMAND_CENTER_VIEW_TYPE; }
  getDisplayText(): string { return "Command center"; }
  override getIcon(): string { return "layout-dashboard"; }

  override async onOpen(): Promise<void> {
    this.isOpen = true;
    this.contentEl.addClass("kh-command-center");
    this.contentEl.createEl("h3", { text: "Command center", cls: "kh-command-center-title" });
    this.contentEl.createDiv({ text: "Loading…" });
    const bump = (): void => void this.refresh();
    for (const ev of BUS_EVENTS) this.offs.push(this.hub.events.on(ev, bump));
    this.timer = window.setInterval(bump, REFRESH_MS);
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.isOpen = false;
    this.offs.forEach((o) => o());
    this.offs = [];
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    const seq = ++this.seq;
    const now = new Date();
    try {
      const data = await loadCommandCenterData(this.reader());
      if (!this.isOpen || seq !== this.seq) return;
      this.paint(buildCommandCenterModel(data, now));
    } catch (e) {
      console.error("kyle-hub: command center refresh failed", e);
      if (!this.isOpen || seq !== this.seq) return;
      this.contentEl.empty();
      this.contentEl.createEl("h3", { text: "Command center", cls: "kh-command-center-title" });
      this.contentEl.createDiv({ text: `Failed to load: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private paint(m: CommandCenterModel): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("h3", { text: "Command center", cls: "kh-command-center-title" });

    const tiles = el.createDiv({ cls: "kh-command-center-tiles" });
    for (const t of m.tiles) this.paintTile(tiles, t);

    this.paintUsage(el, m.usage);

    this.paintSection(el, "Needs attention", m.attention, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "None" });
      for (const r of rows) {
        const li = list.createEl("li", { cls: "kh-command-center-row", text: `${r.ticketId} · ${r.reason}` });
        li.addEventListener("click", () => void this.focusTicket(r.ticketId));
      }
    });

    this.paintSection(el, "Recent runs", m.recentRuns, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "No runs yet" });
      for (const r of rows) list.createEl("li", { cls: "kh-command-center-row", text: `${r.ticketId ?? r.runId} · ${r.outcome} · $${r.costUsd.toFixed(2)}` });
    });

    this.paintSection(el, "Open proposals", m.proposals, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "None" });
      for (const p of rows) list.createEl("li", { cls: "kh-command-center-row", text: `${p.id} · ${p.title}` });
    });

    const spark = el.createDiv({ cls: "kh-command-center-spend" });
    spark.createEl("h4", { text: "Spend, last 30 days" });
    if (m.sparkline.state !== "ok") spark.createDiv({ text: degradedText(m.sparkline) });
    else {
      spark.createDiv({ cls: "kh-command-center-spend-total", text: `$${m.sparkline.value.total.toFixed(2)}` });
      if (m.sparkline.value.path) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`);
        svg.setAttribute("class", "kh-command-center-sparkline");
        svg.setAttribute("preserveAspectRatio", "none");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", m.sparkline.value.path);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--interactive-accent)");
        path.setAttribute("stroke-width", "2");
        svg.appendChild(path);
        spark.appendChild(svg);
      }
    }
  }

  private paintUsage(el: HTMLElement, p: Part<UsageRow[]>): void {
    const box = el.createDiv({ cls: "kh-command-center-usage kh-usage-tile" });
    box.createEl("h4", { text: "Usage" });
    if (p.state !== "ok") return void box.createDiv({ text: degradedText(p) });
    if (p.value.length === 0) return void box.createDiv({ text: "No accounts" });
    for (const r of p.value) {
      const row = box.createDiv({ cls: "kh-usage-row", attr: { "data-account": r.accountId } });
      row.createDiv({ cls: "kh-usage-label", text: `${r.label} (${r.source})` });
      if (r.dollars) {
        const d = r.dollars;
        row.createDiv({ cls: "kh-usage-dollars", text: `${d.today} today · ${d.month} this month${d.budget ? ` of ${d.budget}` : ""}` });
        continue;
      }
      for (const b of r.bars ?? []) {
        const line = row.createDiv({ cls: `kh-usage-bar kh-usage-bar-${b.id}` });
        line.createSpan({ cls: "kh-usage-bar-label", text: `${b.label} ${b.percent}%${b.reset ? ` · resets ${b.reset}` : ""}` });
        const track = line.createDiv({ cls: "kh-usage-track" });
        const fill = track.createDiv({ cls: "kh-usage-fill" });
        fill.style.width = `${Math.min(100, b.percent)}%`;
        if (b.percent >= 80) fill.addClass("kh-usage-fill-warn");
      }
    }
  }

  private paintTile(parent: HTMLElement, t: Tile): void {
    const card = parent.createDiv({ cls: `kh-command-center-tile kh-command-center-tile-${t.state}` });
    card.createDiv({ cls: "kh-command-center-tile-label", text: t.label });
    card.createDiv({ cls: "kh-command-center-tile-value", text: t.value });
    if (t.detail) card.createDiv({ cls: "kh-command-center-tile-detail", text: t.detail });
  }

  private paintSection<T>(el: HTMLElement, title: string, p: Part<T[]>, fill: (list: HTMLElement, rows: T[]) => void): void {
    el.createEl("h4", { text: title });
    if (p.state !== "ok") {
      el.createDiv({ text: degradedText(p) });
      return;
    }
    fill(el.createEl("ul", { cls: "kh-command-center-list" }), p.value);
  }
}

function degradedText(p: Part<unknown>): string {
  return p.state === "disabled" ? "module disabled" : p.state === "error" ? "unavailable" : "";
}
