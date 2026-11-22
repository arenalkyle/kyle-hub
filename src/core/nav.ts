import type { App, WorkspaceLeaf } from "obsidian";

/** One button in the header nav shown on every kyle-hub view. */
export interface NavItem {
  id: string;
  label: string;
  icon: string;
  /** View type this item opens; the item is highlighted while that view is active. */
  viewType: string;
  order: number;
  open(): void;
}

export class NavRegistry {
  private items = new Map<string, NavItem>();
  private listeners = new Set<() => void>();

  add(item: NavItem): () => void {
    this.items.set(item.id, item);
    this.emit();
    return () => {
      if (this.items.get(item.id) === item) this.items.delete(item.id);
      this.emit();
    };
  }

  list(): NavItem[] {
    return [...this.items.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }

  viewTypes(): Set<string> {
    return new Set(this.list().map((i) => i.viewType));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

const NAV_CLASS = "kh-nav";

/** Renders (or removes) the nav bar in the header of every open kyle-hub view. */
export function renderNav(app: App, nav: NavRegistry): void {
  // Lazy: keeps this file importable without the obsidian runtime (unit tests).
  const { setIcon } = require("obsidian") as typeof import("obsidian");
  const types = nav.viewTypes();
  const items = nav.list();
  app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
    const header = (leaf.view as { containerEl?: HTMLElement }).containerEl?.querySelector<HTMLElement>(".view-header");
    if (!header) return;
    header.querySelector(`.${NAV_CLASS}`)?.remove();
    const type = leaf.view.getViewType();
    if (!types.has(type)) return;
    const bar = createDiv({ cls: NAV_CLASS });
    for (const item of items) {
      const btn = bar.createEl("button", { cls: "kh-nav-item" + (item.viewType === type ? " is-active" : ""), attr: { "aria-label": item.label } });
      setIcon(btn.createSpan({ cls: "kh-nav-icon" }), item.icon);
      btn.createSpan({ text: item.label, cls: "kh-nav-label" });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        item.open();
      });
    }
    const actions = header.querySelector(".view-actions");
    header.insertBefore(bar, actions);
  });
}
