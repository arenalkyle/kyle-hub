import fs from "node:fs";
import path from "node:path";
import { App, Modal, Notice, Setting } from "obsidian";
import type { PromotePlan } from "../../core/domain/promote";

/** `<dir>/<name>.md`, or `<name>-2.md`, `-3`... when taken (never overwrites). */
export function uniqueTarget(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  let n = 1;
  let p = path.join(dir, fileName);
  while (fs.existsSync(p)) p = path.join(dir, `${base}-${++n}${ext}`);
  return p;
}

/** Before/after diff of the scrubbed note. Writing happens only on Promote; nothing is automatic. */
export class PromoteModal extends Modal {
  constructor(app: App, private readonly plan: PromotePlan, private readonly homeVaultPath: string) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, plan } = this;
    this.setTitle("Promote to home");
    contentEl.addClass("kh-brain-promote");
    const summary = Object.entries(plan.counts).map(([k, n]) => `${k}: ${n}`).join(", ") || "nothing to scrub";
    contentEl.createEl("p", { text: `Target: ${this.homeVaultPath || "(home vault path not set)"} / ${plan.targetRel}`, cls: "kh-brain-promote-target" });
    contentEl.createEl("p", { text: `Scrubbed: ${summary}`, cls: "kh-brain-promote-summary" });
    const pre = contentEl.createEl("pre", { cls: "kh-brain-promote-diff" });
    for (const line of plan.diff.split("\n")) {
      const cls = line.startsWith("+") && !line.startsWith("+++") ? "is-add" : line.startsWith("-") && !line.startsWith("---") ? "is-del" : "";
      pre.createEl("div", { text: line === "" ? " " : line, cls: cls ? `kh-brain-promote-line ${cls}` : "kh-brain-promote-line" });
    }
    if (!this.homeVaultPath) {
      contentEl.createEl("p", { text: "Set the home vault path in kyle-hub settings (Profile and promote) to enable Promote.", cls: "mod-warning" });
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText("Promote").setCta().setDisabled(!this.homeVaultPath).onClick(() => {
          try {
            const dir = path.join(this.homeVaultPath, ...path.posix.dirname(plan.targetRel).split("/"));
            fs.mkdirSync(dir, { recursive: true });
            const dest = uniqueTarget(dir, path.posix.basename(plan.targetRel));
            fs.writeFileSync(dest, plan.after, "utf8");
            new Notice(`kyle-hub: promoted to ${dest}`);
            this.close();
          } catch (e) {
            new Notice(`kyle-hub: promote failed: ${(e as Error).message}`, 8000);
          }
        });
        b.buttonEl.addClass("kh-brain-promote-confirm");
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
