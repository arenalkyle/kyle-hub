import { Notice } from "obsidian";

/** A persistent notice with Remove / Keep buttons; resolves true for Remove. Dismissing it counts as Keep. */
export function offerNotice(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const frag = document.createDocumentFragment();
    frag.createDiv({ text: `kyle-hub: ${message}` });
    const row = frag.createDiv({ cls: "kh-term-offer" });
    let settled = false;
    let notice: Notice | undefined;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      notice?.hide();
      resolve(v);
    };
    row.createEl("button", { text: "Remove", cls: "mod-warning" }).onclick = () => done(true);
    row.createEl("button", { text: "Keep" }).onclick = () => done(false);
    notice = new Notice(frag, 0);
  });
}
