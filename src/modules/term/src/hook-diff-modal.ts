import { Modal, type App } from "obsidian";
import { diffLines, trimContext } from "./line-diff";

export interface HookDiffInfo {
  mode: "install" | "uninstall";
  file: string;
  before: string;
  after: string;
}

/** Shows what Install/Uninstall hooks will change in `~/.claude/settings.json`; writes only on Apply. */
export class HookDiffModal extends Modal {
  constructor(app: App, private info: HookDiffInfo, private onApply: () => void) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const { mode, file, before, after } = this.info;
    this.titleEl.setText(mode === "install" ? "Install hooks" : "Uninstall hooks");
    contentEl.createEl("p", { text: `This changes ${file}. A backup is written next to it first.` });
    const pre = contentEl.createEl("pre", { cls: "kh-term-diff" });
    for (const l of trimContext(diffLines(before, after))) {
      pre.createDiv({ cls: `kh-term-diff-${l.kind}`, text: `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "} ${l.text}` });
    }
    const row = contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const ok = row.createEl("button", { text: mode === "install" ? "Install" : "Uninstall", cls: "mod-cta" });
    ok.onclick = () => {
      this.close();
      this.onApply();
    };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
