import { SuggestModal, type App } from "obsidian";
import type { Account } from "../../../core/accounts";

/** Picks the Claude account for one launch (the preselected one is listed first); resolves undefined when dismissed. */
export class AccountPicker extends SuggestModal<Account> {
  private chosen = false;
  private readonly accounts: Account[];

  constructor(app: App, accounts: Account[], preselected: string | undefined, private done: (id: string | undefined) => void) {
    super(app);
    this.accounts = [...accounts].sort((a, b) => Number(b.id === preselected) - Number(a.id === preselected));
    this.setPlaceholder("Claude account for this run");
  }

  getSuggestions(q: string): Account[] {
    const s = q.toLowerCase();
    return this.accounts.filter((a) => `${a.label} ${a.plan} ${a.kind}`.toLowerCase().includes(s));
  }

  renderSuggestion(a: Account, el: HTMLElement): void {
    el.setText(`${a.label} · ${a.kind}${a.plan ? ` ${a.plan}` : ""}${a.profile ? ` · ${a.profile}` : ""}`);
  }

  onChooseSuggestion(a: Account): void {
    this.chosen = true;
    this.done(a.id);
  }

  override onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      if (!this.chosen) this.done(undefined);
    }, 0);
  }
}
