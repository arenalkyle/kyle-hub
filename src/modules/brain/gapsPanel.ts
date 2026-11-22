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

/** Gaps side panel beside the 3D brain: reads the shared gaps service and re-renders on change. */
export class GapsPanel {
  private cutoff = DEFAULT_CUTOFF;
  private report: GapsReport | undefined;
  private list: HTMLElement | undefined;
  private unsub: (() => void) | undefined;

  constructor(
    private readonly el: HTMLElement,
    private readonly svc: GapsService | undefined,
    private readonly select: (notePath: string) => void,
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
    this.section(`Empty searches by agent time (${searches.length})`, searches.map((e) =>
      `${(e.totalMs / 1000).toFixed(1)} s · ${e.root}${e.pattern ? ` "${e.pattern}"` : ""} · ${e.count}×`));
    const missing = [...r.missingNotes].sort((a, b) => b.reads - a.reads);
    this.section(`Missing notes (${missing.length})`, missing.map((m) =>
      `${m.target} · ${m.reads} reads · ${m.emptySearches} empty searches · linked from ${m.linkedFrom.length}`));
    const folders = [...r.largeFolders].sort((a, b) => b.notes - a.notes);
    this.section(`Folders to split (${folders.length})`, folders.map((f) =>
      `${f.folder} · ${f.notes} notes · avg ${Math.round(f.avgWords)} words`));
    const st = r.searchTime;
    this.section("Search time", [
      `${Math.round(st.share * 100)}% of agent time in search`,
      `search ${Math.round(st.searchMs)} ms · read ${Math.round(st.readMs)} ms · lookup ${Math.round(st.lookupMs)} ms · agent ${Math.round(st.agentMs)} ms`,
    ]);
  }

  private renderList(): void {
    if (!this.list || !this.report) return;
    this.list.empty();
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
      head.createSpan({ cls: "kh-brain-gaps-name", text: noteName(g.path) });
      row.createDiv({ cls: "kh-brain-gaps-reason", text: g.reasons });
      row.addEventListener("click", () => this.select(g.path));
    }
  }

  private section(title: string, items: string[]): void {
    this.el.createDiv({ cls: "kh-brain-gaps-heading", text: title });
    if (items.length === 0) this.el.createDiv({ cls: "kh-brain-gaps-muted", text: "None." });
    for (const text of items) this.el.createDiv({ cls: "kh-brain-gaps-item", text });
  }
}
