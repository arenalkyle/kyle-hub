import { Modal, Notice, type App } from "obsidian";
import { useState } from "react";
import type { Issue } from "../../../../../core/domain/types";
import type { RuleDraft } from "../../../../../core/services";
import { usePlugin } from "../PluginContext";

class DraftModal extends Modal {
  constructor(app: App, private draft: RuleDraft, private onConfirm: () => void) {
    super(app);
  }
  override onOpen(): void {
    this.titleEl.setText("Draft rule with Haiku");
    this.contentEl.createEl("p", { text: `Proposed CLAUDE.md change in ${this.draft.root} (cost $${this.draft.costUsd.toFixed(4)}). Confirming turns this finding into a proposal.` });
    this.contentEl.createEl("pre", { cls: "kh-term-draft-diff", text: this.draft.diff });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const ok = row.createEl("button", { text: "Convert to proposal", cls: "mod-cta" });
    ok.onclick = () => {
      this.close();
      this.onConfirm();
    };
  }
  override onClose(): void {
    this.contentEl.empty();
  }
}

/** Apply (accepted proposals) and Draft rule with Haiku (opt-in, user-correction findings); both come from the retro service. */
export function RetroActions({ issue }: { issue: Issue }) {
  const { hub } = usePlugin();
  const svc = hub.services.get("retro");
  const [busy, setBusy] = useState(false);
  if (!svc) return null;
  const canApply = svc.canApply(issue.id);
  const canDraft = svc.canDraft(issue.id);
  if (!canApply && !canDraft) return null;
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    void fn()
      .catch((e: unknown) => new Notice(`kyle-hub: ${(e as Error).message}`, 8000))
      .finally(() => setBusy(false));
  };
  return (
    <div className="kh-tickets-retro-actions">
      {canApply && (
        <button
          type="button"
          className="mod-cta"
          disabled={busy}
          data-kh-retro-action="apply"
          onClick={() =>
            run(async () => {
              const r = await svc.apply(issue.id);
              new Notice(`kyle-hub: ${r.ok ? r.message : `Apply failed: ${r.message}`}`, 8000);
            })
          }
        >
          Apply
        </button>
      )}
      {canDraft && (
        <button
          type="button"
          disabled={busy}
          data-kh-retro-action="draft"
          onClick={() =>
            run(async () => {
              const r = await svc.draft(issue.id);
              if (!r.ok) {
                new Notice(`kyle-hub: ${r.message}`, 8000);
                return;
              }
              new DraftModal(hub.app, r.draft, () => run(() => svc.confirmDraft(issue.id, r.draft))).open();
            })
          }
        >
          Draft rule with Haiku
        </button>
      )}
    </div>
  );
}
