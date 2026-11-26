import fs from "node:fs";
import path from "node:path";
import { App, Modal, Notice, Setting } from "obsidian";
import { DOC_TYPES, type DocType } from "../../core/brain/doctypes";
import type { RepoEntry } from "../../core/brain/service";
import { localDate, planNewDoc } from "./newDoc";

export interface NewDocDeps {
  repos: () => Record<string, RepoEntry>;
  now: () => Date;
  /** Vault-relative brain folder (setting). */
  brainFolder: () => string;
}

export async function ensureVaultDir(app: App, dir: string): Promise<void> {
  let cur = "";
  for (const part of dir.split("/")) {
    cur = cur ? `${cur}/${part}` : part;
    if (!(await app.vault.adapter.exists(cur))) await app.vault.adapter.mkdir(cur);
  }
}

/** Form: type, location (the vault brain folder or a repo-map repo), title. Creates the file from its template. */
export class NewDocModal extends Modal {
  constructor(app: App, private readonly deps: NewDocDeps) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    const repos = this.deps.repos();
    const locations: Record<string, string> = { vault: `Vault: ${this.deps.brainFolder()}/` };
    for (const k of Object.keys(repos)) locations[`repo:${k}`] = `Repo: ${k}`;
    let type: DocType = "lesson";
    let location = "vault";
    let title = "";
    this.setTitle("New doc");
    new Setting(contentEl).setName("Type").addDropdown((d) =>
      d.addOptions(Object.fromEntries(DOC_TYPES.map((t) => [t, t]))).setValue(type).onChange((v) => (type = v as DocType)),
    );
    new Setting(contentEl).setName("Location").addDropdown((d) => d.addOptions(locations).setValue(location).onChange((v) => (location = v)));
    new Setting(contentEl).setName("Title").addText((t) => t.onChange((v) => (title = v.trim())));
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Create").setCta().onClick(() => void this.create(type, location, title)),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private async create(type: DocType, location: string, title: string): Promise<void> {
    if (title === "") return void new Notice("kyle-hub: title is required.");
    const date = localDate(this.deps.now());
    try {
      if (location === "vault") {
        const plan = planNewDoc(type, title, date, { kind: "vault", brainFolder: this.deps.brainFolder() });
        if (plan.issues.some((i) => i.severity === "error")) throw new Error(plan.issues[0]!.message);
        if (await this.app.vault.adapter.exists(plan.path)) throw new Error(`${plan.path} already exists`);
        await ensureVaultDir(this.app, path.posix.dirname(plan.path));
        await this.app.vault.adapter.write(plan.path, plan.content);
        this.close();
        void this.app.workspace.openLinkText(plan.path, "");
        return;
      }
      const key = location.replace(/^repo:/, "");
      const root = this.deps.repos()[key]?.path;
      if (!root) throw new Error(`repo "${key}" is not in the repo map`);
      const adrDir = path.join(root, "docs", "adr");
      const adrFileNames = fs.existsSync(adrDir) ? fs.readdirSync(adrDir) : [];
      const plan = planNewDoc(type, title, date, { kind: "repo", root, adrFileNames });
      if (plan.issues.some((i) => i.severity === "error")) throw new Error(plan.issues[0]!.message);
      const abs = path.join(root, plan.path);
      if (fs.existsSync(abs)) throw new Error(`${plan.path} already exists`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, plan.content, "utf8");
      this.close();
      new Notice(`kyle-hub: created ${abs}`);
    } catch (e) {
      new Notice(`kyle-hub: ${(e as Error).message}`);
    }
  }
}
