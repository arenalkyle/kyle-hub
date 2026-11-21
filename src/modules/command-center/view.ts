import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { Hub } from "../../core";
import type { BrainInventory } from "../../core/brain/inventory";
import { METRICS, SensorSampler, sparkPoints } from "./sensors";
import { buildCommandCenterModel, loadCommandCenterData, SPARKLINE_HEIGHT, SPARKLINE_WIDTH, type CommandCenterModel, type CommandCenterReader, type Part, type Tile, type UsageRow } from "./model";

export const COMMAND_CENTER_VIEW_TYPE = "kh-command-center-view";
const REFRESH_MS = 60_000;
const SENSOR_HISTORY = 90;

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
  private sysEl: HTMLElement | null = null;
  private sensors = new SensorSampler(SENSOR_HISTORY, () => this.paintSystem());

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
    this.sensors.start();
    await this.refresh();
  }

  override async onClose(): Promise<void> {
    this.isOpen = false;
    this.sensors.stop();
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
      let inv: BrainInventory | undefined;
      try {
        inv = this.reader().brain?.inventory();
      } catch {
        inv = undefined;
      }
      this.paint(buildCommandCenterModel(data, now), inv);
    } catch (e) {
      console.error("kyle-hub: command center refresh failed", e);
      if (!this.isOpen || seq !== this.seq) return;
      this.contentEl.empty();
      this.contentEl.createEl("h3", { text: "Command center", cls: "kh-command-center-title" });
      this.contentEl.createDiv({ text: `Failed to load: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private paint(m: CommandCenterModel, inv: BrainInventory | undefined): void {
    const el = this.contentEl;
    el.empty();
    el.createEl("h3", { text: "Command center", cls: "kh-command-center-title" });
    const layout = el.createDiv({ cls: "kh-command-center-layout" });
    const left = layout.createDiv({ cls: "kh-command-center-pane" });
    const center = layout.createDiv({ cls: "kh-command-center-pane kh-command-center-pane-main" });
    const right = layout.createDiv({ cls: "kh-command-center-pane" });
    const tile = (id: string): Tile | undefined => m.tiles.find((t) => t.id === id);

    // Left: work state
    const stats = left.createDiv({ cls: "kh-command-center-tiles" });
    for (const id of ["triage", "running", "needs-attention", "queue"]) {
      const t = tile(id);
      if (t) this.paintTile(stats, t);
    }
    this.paintSection(left, "Needs attention", m.attention, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "None" });
      for (const r of rows) {
        const li = list.createEl("li", { cls: "kh-command-center-row", text: `${r.ticketId} · ${r.reason}` });
        li.addEventListener("click", () => void this.focusTicket(r.ticketId));
      }
    });
    this.paintSection(left, "Recent runs", m.recentRuns, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "No runs yet" });
      for (const r of rows) {
        const li = list.createEl("li", { cls: "kh-command-center-row kh-command-center-run" });
        li.createSpan({ cls: "kh-command-center-run-id", text: r.ticketId ?? r.runId, attr: { title: r.runId } });
        li.createSpan({ cls: `kh-command-center-badge is-${r.outcome}`, text: r.outcome });
        li.createSpan({ cls: "kh-command-center-run-cost", text: `$${r.costUsd.toFixed(2)}` });
      }
    });
    this.paintSection(left, "Open proposals", m.proposals, (list, rows) => {
      if (rows.length === 0) list.createEl("li", { text: "None" });
      for (const p of rows) {
        const li = list.createEl("li", { cls: "kh-command-center-row", text: `${p.id} · ${p.title}` });
        li.addEventListener("click", (e) => this.hub.services.get("tickets")?.open?.(p.id, e.ctrlKey || e.metaKey));
      }
    });

    // Center: spend
    const spend = center.createDiv({ cls: "kh-command-center-spend kh-command-center-card" });
    spend.createEl("h4", { text: "Spend" });
    const st = tile("spend");
    if (m.sparkline.state !== "ok" || !st || st.state !== "ok") spend.createDiv({ cls: "kh-command-center-empty", text: degradedText(m.sparkline) });
    else {
      spend.createDiv({ cls: "kh-command-center-spend-total", text: `$${m.sparkline.value.total.toFixed(2)}` });
      spend.createDiv({ cls: "kh-command-center-empty", text: `last 30 days · ${st.value} · ${st.detail ?? ""}` });
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
        path.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(path);
        spend.appendChild(svg);
      }
    }
    this.paintUsage(center, m.usage);
    const retro = tile("retro");
    if (retro) {
      const c = center.createDiv({ cls: "kh-command-center-card" });
      c.createEl("h4", { text: "Retro" });
      c.createDiv({ text: retro.value });
      if (retro.detail) c.createDiv({ cls: "kh-command-center-empty", text: retro.detail });
    }

    // Right: brain and system
    const brain = right.createDiv({ cls: "kh-command-center-card" });
    brain.createEl("h4", { text: "Brain" });
    const bt = tile("brain");
    if (bt) brain.createDiv({ cls: "kh-command-center-brain-score", text: bt.state === "ok" ? `${bt.value} / 100` : bt.value });
    if (inv) {
      const counts = brain.createDiv({ cls: "kh-command-center-counts" });
      for (const [label, n] of [["Docs", inv.docs], ["Scripts", inv.scripts], ["Skills", inv.skills], ["Agents", inv.agents]] as const) {
        const c = counts.createDiv({ cls: "kh-command-center-count" });
        c.createDiv({ cls: "kh-command-center-count-n", text: String(n) });
        c.createDiv({ cls: "kh-command-center-empty", text: label });
      }
    }
    this.sysEl = right.createDiv({ cls: "kh-command-center-card kh-command-center-system" });
    this.paintSystem();
  }

  private paintSystem(): void {
    const box = this.sysEl;
    if (!box || !box.isConnected) return;
    box.empty();
    const hist = this.sensors.history;
    const last = hist[hist.length - 1];
    box.createEl("h4", { text: `System${last?.gpu ? ` · ${last.gpu.name}` : ""}` });
    if (!last) return void box.createDiv({ cls: "kh-command-center-empty", text: "Sampling…" });
    for (const spec of METRICS) {
      const v = spec.value(last);
      const row = box.createDiv({ cls: "kh-command-center-metric" });
      const head = row.createDiv({ cls: "kh-command-center-metric-head" });
      head.createSpan({ text: spec.label });
      head.createSpan({ cls: "kh-command-center-metric-value", text: v === undefined ? "n/a" : `${spec.id === "ram" ? v.toFixed(1) : Math.round(v)}${spec.unit}` });
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 200 36");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("class", "kh-command-center-chart");
      const pts = sparkPoints(hist, spec, 200, 36, SENSOR_HISTORY);
      if (pts) {
        const parts = pts.split(" ");
        const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        area.setAttribute("points", `${parts[0]!.split(",")[0]},36 ${pts} ${parts[parts.length - 1]!.split(",")[0]},36`);
        area.setAttribute("class", "kh-command-center-chart-area");
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("points", pts);
        line.setAttribute("class", "kh-command-center-chart-line");
        line.setAttribute("vector-effect", "non-scaling-stroke");
        svg.append(area, line);
      }
      row.appendChild(svg);
    }
    box.createDiv({ cls: "kh-command-center-empty", text: "CPU temperature needs a sensor tool and isn't shown yet." });
  }

  private paintUsage(el: HTMLElement, p: Part<UsageRow[]>): void {
    const box = el.createDiv({ cls: "kh-command-center-usage kh-usage-tile kh-command-center-card" });
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
    const card = el.createDiv({ cls: "kh-command-center-card" });
    card.createEl("h4", { text: title });
    if (p.state !== "ok") {
      card.createDiv({ cls: "kh-command-center-empty", text: degradedText(p) });
      return;
    }
    fill(card.createEl("ul", { cls: "kh-command-center-list" }), p.value);
  }
}

function degradedText(p: Part<unknown>): string {
  return p.state === "disabled" ? "module disabled" : p.state === "error" ? "unavailable" : "";
}
