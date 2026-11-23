import { BRAIN_THEMES, DEFAULT_THEME, isThemeId } from "../../core/domain/brainTheme";
import { SHAPES } from "../../core/domain/brainShape";
import {
  isOrbitHex,
  nextOrbitColor,
  normalizeOrbitColor,
  normalizeOrbitMode,
  normalizeOrbitOpacity,
  normalizeToasts,
  ORBIT_MODES,
  orbitColorKind,
  type OrbitColorKind,
} from "../../core/domain/brainMenu";
import { rotateSpeedOf } from "../../core/domain/autoRotate";
import type { BrainHandle } from "../../core";
import { setIcon } from "obsidian";

export const BRAIN_MENU_BUTTON_CLASS = "kh-command-center-brain-btn";

export interface BrainPopoverDeps {
  /** Element the popover is attached to (outside the repainted scroller, so it survives repaints). */
  host: HTMLElement;
  /** Live brain settings object; writes go through `save`. */
  brain(): Record<string, unknown>;
  rateUnit(): "hour" | "minute";
  setRateUnit(unit: "hour" | "minute"): void;
  /** Merges `patch` into the brain settings and persists them. */
  saveBrain(patch: Record<string, unknown>): void;
  handle(): BrainHandle | undefined;
}

/** Brain menu popover opened from the Brain Vitals icon. Esc closes it and returns focus to the icon. */
export class BrainPopover {
  private el: HTMLElement | undefined;
  private anchor: HTMLElement | undefined;

  constructor(private readonly deps: BrainPopoverDeps) {
    deps.host.addEventListener("scroll", this.place, true);
  }

  get isOpen(): boolean {
    return this.el !== undefined;
  }

  /** The icon may be recreated by a repaint; the popover always returns focus to the latest one. */
  setAnchor(icon: HTMLElement | undefined): void {
    this.anchor = icon;
    icon?.setAttr("aria-expanded", String(this.isOpen));
  }

  toggle(icon: HTMLElement): void {
    if (this.isOpen) this.close(true);
    else this.open(icon);
  }

  open(icon: HTMLElement): void {
    if (this.isOpen) return;
    this.setAnchor(icon);
    const el = this.deps.host.createDiv({ cls: "kh-command-center-brain-menu", attr: { role: "dialog", "aria-label": "Brain settings" } });
    el.tabIndex = -1;
    el.addEventListener("keydown", this.onKey);
    this.el = el;
    this.populate(el);
    this.place();
    this.setAnchor(icon);
    document.addEventListener("pointerdown", this.onOutside, true);
    (el.querySelector<HTMLElement>("select, input, button") ?? el).focus();
  }

  close(restoreFocus: boolean): void {
    if (!this.el) return;
    this.el.remove();
    this.el = undefined;
    document.removeEventListener("pointerdown", this.onOutside, true);
    this.anchor?.setAttr("aria-expanded", "false");
    if (restoreFocus) this.anchor?.focus();
  }

  dispose(): void {
    this.close(false);
    this.deps.host.removeEventListener("scroll", this.place, true);
  }

  private readonly place = (): void => {
    const rect = this.anchor?.getBoundingClientRect();
    if (!this.el || !rect) return;
    this.el.style.top = `${rect.bottom + 6}px`;
    this.el.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  };

  private readonly onOutside = (ev: PointerEvent): void => {
    const t = ev.target;
    if (!(t instanceof Node) || this.el?.contains(t)) return;
    if (t instanceof Element && t.closest(`.${BRAIN_MENU_BUTTON_CLASS}`)) return; // the icon's own click toggles
    this.close(false);
  };

  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this.close(true);
      return;
    }
    if (ev.key !== "Tab" || !this.el) return;
    const items = [...this.el.querySelectorAll<HTMLElement>("select, input, button")].filter((e) => !e.hasAttribute("disabled"));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    const outside = !(active instanceof Node) || !this.el.contains(active);
    if (ev.shiftKey && (active === first || outside)) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || outside)) {
      ev.preventDefault();
      first.focus();
    }
  };

  private populate(el: HTMLElement): void {
    const { handle } = this.deps;
    const s = this.deps.brain();
    el.createEl("h5", { text: "Brain" });
    const folders = handle()?.folderChoices() ?? [];
    if (folders.length > 0) {
      const sel = this.field(el, "Folder focus").createEl("select", { cls: "dropdown" });
      sel.createEl("option", { text: "All folders", value: "" });
      for (const f of folders) sel.createEl("option", { text: `${"  ".repeat(f.depth)}${f.name} (${f.notes})`, value: f.path });
      sel.value = handle()?.focused() ?? "";
      sel.addEventListener("change", () => handle()?.focusFolder(sel.value || null));
    }
    this.select(el, "Theme", BRAIN_THEMES.map((t) => [t.id, t.name]), isThemeId(s.theme) ? String(s.theme) : DEFAULT_THEME, (v) => this.deps.saveBrain({ theme: v }));
    const shape = SHAPES.some((x) => x.id === s.shape) ? String(s.shape) : "brain";
    this.select(el, "Shape", SHAPES.map((x) => [x.id, x.name]), shape, (v) => this.deps.saveBrain({ shape: v }));
    this.select(el, "Orbit mode", ORBIT_MODES.map((m) => [m, m]), normalizeOrbitMode(s.orbitMode), (v) => this.deps.saveBrain({ orbitMode: v }));

    const colour = normalizeOrbitColor(s.orbitColor);
    const hex = this.field(el, "Orbit colour").createEl("input", { type: "text", cls: "kh-command-center-brain-hex", attr: { placeholder: "#rrggbb", "aria-label": "Custom orbit colour", spellcheck: "false" } });
    hex.value = orbitColorKind(colour) === "custom" ? colour : "";
    this.select(el, "Orbit colour mode", [["default", "Default"], ["rainbow", "Rainbow"], ["custom", "Custom hex"]], orbitColorKind(colour), (v) => {
      const next = nextOrbitColor(v as OrbitColorKind, colour);
      hex.value = orbitColorKind(next) === "custom" ? next : "";
      this.deps.saveBrain({ orbitColor: next });
    });
    hex.addEventListener("input", () => {
      const ok = isOrbitHex(hex.value);
      hex.classList.toggle("is-invalid", hex.value.trim() !== "" && !ok);
      if (ok) this.deps.saveBrain({ orbitColor: normalizeOrbitColor(hex.value) });
    });

    this.range(el, "Orbit opacity", normalizeOrbitOpacity(s.orbitOpacity), (v) => this.deps.saveBrain({ orbitOpacity: v }));
    this.range(el, "Rotation speed", rotateSpeedOf(s.rotateSpeed), (v) => this.deps.saveBrain({ rotateSpeed: v }));
    this.check(el, "Notifications", normalizeToasts(s.toasts), (v) => this.deps.saveBrain({ toasts: v }));
    this.select(el, "Notes-read rate", [["hour", "Per hour"], ["minute", "Per min"]], this.deps.rateUnit(), (v) => this.deps.setRateUnit(v === "minute" ? "minute" : "hour"));
  }

  private field(parent: HTMLElement, label: string): HTMLElement {
    const lab = parent.createEl("label", { cls: "kh-command-center-brain-menu-row" });
    lab.createSpan({ text: label });
    return lab;
  }

  private select(parent: HTMLElement, label: string, options: readonly (readonly [string, string])[], value: string, onChange: (v: string) => void): HTMLSelectElement {
    const sel = this.field(parent, label).createEl("select", { cls: "dropdown" });
    for (const [v, text] of options) sel.createEl("option", { text, value: v });
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  private range(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void): void {
    const input = this.field(parent, label).createEl("input", { type: "range", attr: { min: "0", max: "1", step: "0.05", "aria-label": label } });
    input.value = String(value);
    input.addEventListener("input", () => onChange(Number(input.value)));
  }

  private check(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
    const input = this.field(parent, label).createEl("input", { type: "checkbox" });
    input.checked = value;
    input.addEventListener("change", () => onChange(input.checked));
  }
}

/** Icon button for the Brain Vitals title row. */
export function brainIconButton(head: HTMLElement): HTMLButtonElement {
  const btn = head.createEl("button", { cls: `clickable-icon ${BRAIN_MENU_BUTTON_CLASS}`, attr: { "aria-label": "Brain settings", "aria-haspopup": "dialog", "aria-expanded": "false", title: "Brain settings" } });
  setIcon(btn, "brain");
  return btn;
}
