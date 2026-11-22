import type { GapsReport, GradedNote } from "../../core/domain/gaps";
import type { GapsService } from "../../core";

export const DEFAULT_CUTOFF = 70;
const NO_DATA = "No gaps data yet. Run `kh maintain`.";

/** Notes scoring under the cutoff, worst first (lowest score, then path). */
export function worstFirst(grades: readonly GradedNote[], cutoff: number): GradedNote[] {
  return grades.filter((g) => g.score < cutoff).sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
}

/** Note name without its folder or `.md` extension. */
export function noteName(notePath: string): string {
  return notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/, "");
}

/** A sub-list row; `links` are note references that open in a new tab when clicked. */
interface SubItem {
  text: string;
  links?: string[];
}

/** Row click selects (highlight on the brain); the note name or a row double-click opens the note in a new tab. */
export interface GapsPanelActions {
  select(notePath: string): void;
  open(notePath: string): void;
}

/** Gaps side panel beside the 3D brain: reads the shared gaps service and re-renders on change. */
export class GapsPanel {
  private cutoff = DEFAULT_CUTOFF;
  private report: GapsReport | undefined;
  private list: HTMLElement | undefined;
  private rows: Array<{ path: string; el: HTMLElement }> = [];
  private selected: string | undefined;
  private unsub: (() => void) | undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly svc: GapsService | undefined,
    private readonly actions: GapsPanelActions,
  ) {}

  mount(): void {
    this.unsub = this.svc?.onChange(() => this.refresh());
    this.refresh();
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = undefined;
  }

  private refresh(): void {
    this.report = this.svc?.read();
    this.el.empty();
    this.el.createDiv({ cls: "kh-brain-gaps-title", text: "Gaps" });
    const r = this.report;
    if (r === undefined) {
      this.el.createDiv({ cls: "kh-brain-gaps-empty", text: NO_DATA });
      return;
    }
    if (r.warning) this.el.createDiv({ cls: "kh-brain-gaps-muted", text: r.warning });

    const cutoff = this.el.createEl("label", { cls: "kh-brain-gaps-cutoff" });
    const label = cutoff.createSpan({ text: `Under ${this.cutoff}` });
    const slider = cutoff.createEl("input", { attr: { type: "range", min: "0", max: "100", step: "1", value: String(this.cutoff) } });
    slider.addEventListener("input", () => {
      this.cutoff = Number(slider.value);
      label.setText(`Under ${this.cutoff}`);
      this.renderList();
    });
    this.list = this.el.createDiv({ cls: "kh-brain-gaps-list" });
    this.renderList();

    const searches = [...r.emptySearches].sort((a, b) => b.totalMs - a.totalMs);
    this.section(`Empty searches by agent time (${searches.length})`, searches.map((e) => ({
      text: `${(e.totalMs / 1000).toFixed(1)} s · ${e.root}${e.pattern ? ` "${e.pattern}"` : ""} · ${e.count}×`,
    })));
    const missing = [...r.missingNotes].sort((a, b) => b.reads - a.reads);
    this.section(`Missing notes (${missing.length})`, missing.map((m) => ({
      text: `${m.target} · ${m.reads} reads · ${m.emptySearches} empty searches · linked from ${m.linkedFrom.length}`,
      links: m.linkedFrom,
    })));
    const folders = [...r.largeFolders].sort((a, b) => b.notes - a.notes);
    this.section(`Folders to split (${folders.length})`, folders.map((f) => ({
      text: `${f.folder} · ${f.notes} notes · avg ${Math.round(f.avgWords)} words`,
    })));
    const st = r.searchTime;
    this.section("Search time", [
      { text: `${Math.round(st.share * 100)}% of agent time in search` },
      { text: `search ${Math.round(st.searchMs)} ms · read ${Math.round(st.readMs)} ms · lookup ${Math.round(st.lookupMs)} ms · agent ${Math.round(st.agentMs)} ms` },
    ]);
  }

  private renderList(): void {
    if (!this.list || !this.report) return;
    this.list.empty();
    this.rows = [];
    const rows = worstFirst(this.report.grades, this.cutoff);
    if (rows.length === 0) {
      this.list.createDiv({ cls: "kh-brain-gaps-muted", text: `No notes under ${this.cutoff}.` });
      return;
    }
    for (const g of rows) {
      const row = this.list.createEl("button", { cls: "kh-brain-gaps-row" });
      const head = row.createDiv({ cls: "kh-brain-gaps-head" });
      head.createSpan({ cls: `kh-brain-gaps-grade kh-brain-gaps-grade-${g.grade}`, text: g.grade });
      head.createSpan({ cls: "kh-brain-gaps-score", text: String(g.score) });
      const name = head.createSpan({ cls: "kh-brain-gaps-name kh-brain-gaps-link", text: noteName(g.path) });
      row.createDiv({ cls: "kh-brain-gaps-reason", text: g.reasons });
      row.toggleClass("kh-brain-gaps-selected", g.path === this.selected);
      this.rows.push({ path: g.path, el: row });
      row.addEventListener("click", (ev) => {
        if (ev.target instanceof HTMLElement && ev.target.closest(".kh-brain-gaps-name")) return;
        this.selectRow(g.path);
      });
      row.addEventListener("dblclick", (ev) => {
        if (ev.target instanceof HTMLElement && ev.target.closest(".kh-brain-gaps-name")) return;
        this.actions.open(g.path);
      });
      name.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // Only the first click of a double-click opens; the row's dblclick skips the name.
        if (ev.detail <= 1) this.actions.open(g.path);
      });
    }
  }

  /** Marks the row selected without rebuilding the list, so a double-click still lands on its row. */
  private selectRow(notePath: string): void {
    this.selected = notePath;
    for (const r of this.rows) r.el.toggleClass("kh-brain-gaps-selected", r.path === notePath);
    this.actions.select(notePath);
  }

  private section(title: string, items: SubItem[]): void {
    this.el.createDiv({ cls: "kh-brain-gaps-heading", text: title });
    if (items.length === 0) this.el.createDiv({ cls: "kh-brain-gaps-muted", text: "None." });
    for (const item of items) {
      const line = this.el.createDiv({ cls: "kh-brain-gaps-item", text: item.text });
      for (const link of item.links ?? []) {
        line.createSpan({ cls: "kh-brain-gaps-link", text: ` [${link}]` }).addEventListener("click", () => this.actions.open(link));
      }
    }
  }
}
