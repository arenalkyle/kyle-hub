import { Modal, Notice, Setting, type App } from "obsidian";
import type { Issue } from "../core/types";
import type { IssuePatch } from "../core/issueFile";
import { BULK_PROGRESS_THRESHOLD } from "../store/IssueStore";
import type KyleTicketsPlugin from "../main";

class DialogModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly build: (el: HTMLElement, done: () => void, cancel: () => void) => void,
    private readonly onDismiss: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.title);
    this.build(this.contentEl, () => {
      this.settled = true;
      this.close();
    }, () => this.close());
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.onDismiss();
  }
}

export function confirmModal(app: App, title: string, message: string, cta: string, warning = false): Promise<boolean> {
  return new Promise((resolve) => {
    new DialogModal(
      app,
      title,
      (el, done, cancel) => {
        el.createEl("p", { text: message });
        new Setting(el)
          .addButton((b) => {
            b.setButtonText(cta).onClick(() => {
              resolve(true);
              done();
            });
            if (warning) b.setWarning();
            else b.setCta();
          })
          .addButton((b) => b.setButtonText("Cancel").onClick(cancel));
      },
      () => resolve(false),
    ).open();
  });
}

/** Asks for one of `options`; resolves null when cancelled. */
export function chooseModal(app: App, title: string, message: string, options: string[], cta: string): Promise<string | null> {
  return new Promise((resolve) => {
    new DialogModal(
      app,
      title,
      (el, done, cancel) => {
        el.createEl("p", { text: message });
        let value = options[0] ?? "";
        new Setting(el).addDropdown((d) => {
          for (const o of options) d.addOption(o, o);
          d.setValue(value).onChange((v) => (value = v));
        });
        new Setting(el)
          .addButton((b) =>
            b.setButtonText(cta).setWarning().onClick(() => {
              resolve(value || null);
              done();
            }),
          )
          .addButton((b) => b.setButtonText("Cancel").onClick(cancel));
      },
      () => resolve(null),
    ).open();
  });
}

/** Asks for a line of text; resolves null when cancelled. */
export function promptModal(app: App, title: string, initial: string, cta: string): Promise<string | null> {
  return new Promise((resolve) => {
    new DialogModal(
      app,
      title,
      (el, done, cancel) => {
        let value = initial;
        const submit = () => {
          resolve(value);
          done();
        };
        new Setting(el).addText((t) => {
          t.setValue(initial).onChange((v) => (value = v));
          t.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
          });
          window.setTimeout(() => t.inputEl.select(), 0);
        });
        new Setting(el)
          .addButton((b) => b.setButtonText(cta).setCta().onClick(submit))
          .addButton((b) => b.setButtonText("Cancel").onClick(cancel));
      },
      () => resolve(null),
    ).open();
  });
}

/** `IssueStore.bulkUpdate` with a progress notice when more than 20 files are touched. */
export async function bulkWithProgress(
  plugin: KyleTicketsPlugin,
  label: string,
  predicate: (i: Issue) => boolean,
  patch: IssuePatch | ((i: Issue) => IssuePatch),
): Promise<number> {
  let notice: Notice | null = null;
  try {
    return await plugin.store.bulkUpdate(predicate, patch, {
      onProgress: (done, total) => {
        if (total <= BULK_PROGRESS_THRESHOLD) return;
        const msg = `kyle-tickets: ${label} ${done}/${total}`;
        if (notice) notice.setMessage(msg);
        else notice = new Notice(msg, 0);
      },
    });
  } finally {
    (notice as Notice | null)?.hide();
  }
}
