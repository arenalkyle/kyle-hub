import { SuggestModal, type App } from "obsidian";

/** Picks one repo-map key; resolves undefined when dismissed. */
export class RepoPicker extends SuggestModal<string> {
  private chosen = false;

  constructor(app: App, private keys: string[], private done: (key: string | undefined) => void) {
    super(app);
    this.setPlaceholder("Repo for this ticket");
  }

  getSuggestions(q: string): string[] {
    const s = q.toLowerCase();
    return this.keys.filter((k) => k.toLowerCase().includes(s));
  }

  renderSuggestion(k: string, el: HTMLElement): void {
    el.setText(k);
  }

  onChooseSuggestion(k: string): void {
    this.chosen = true;
    this.done(k);
  }

  override onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      if (!this.chosen) this.done(undefined);
    }, 0);
  }
}
