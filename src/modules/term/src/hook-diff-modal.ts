import { Modal, type App } from "obsidian";
import { diffLines, trimContext } from "./line-diff";

export interface HookDiffInfo {
  mode: "install" | "uninstall";
  file: string;
  /** Which file this is, e.g. "vault .claude/settings.local.json". */
  label: string;
  before: string;
  after: string;
}

/** Shows what Install/Uninstall hooks will change in one Claude settings file; writes only on Apply. */
export class HookDiffModal extends Modal {
  private applied = false;

  constructor(app: App, private info: HookDiffInfo, private onApply: () => void, private onCancel: () => void = () => {}) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { mode, file, label, before, after } = this.info;
    this.titleEl.setText(`${mode === "install" ? "Install hooks in" : "Remove hooks from"} ${label}`);
    contentEl.createEl("p", { text: `This changes ${file}. A backup is written next to it first.` });
    const pre = contentEl.createEl("pre", { cls: "kh-term-diff" });
    for (const l of trimContext(diffLines(before, after))) {
      pre.createDiv({ cls: `kh-term-diff-${l.kind}`, text: `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}` });
    }
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const ok = row.createEl("button", { text: mode === "install" ? "Install" : "Uninstall", cls: "mod-cta" });
    ok.onclick = () => {
      this.applied = true;
      this.close();
      this.onApply();
    };
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.applied) this.onCancel();
  }
}
