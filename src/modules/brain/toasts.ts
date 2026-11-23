import { ToastQueue, toastText, type ToastInput } from "../../core/domain/brainToasts";

/** Bottom-right activity toasts over the brain (LOCK-81). The queue is pure; this only paints it and wires hover and click. */
export class ToastHost {
  private readonly queue = new ToastQueue();
  private readonly root: HTMLElement;
  private readonly els = new Map<number, HTMLElement>();
  private enabled = true;
  private timer = 0;

  constructor(host: HTMLElement, private readonly open: (path: string) => void) {
    this.root = host.createDiv({ cls: "kh-brain-toasts" });
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.queue.clear();
      this.paint();
    }
  }

  push(i: ToastInput): void {
    if (!this.enabled) return;
    this.queue.push(i, Date.now());
    this.paint();
    if (!this.timer) this.timer = window.setInterval(() => this.step(), 200);
  }

  private step(): void {
    this.queue.tick(Date.now());
    this.paint();
    if (this.queue.views().length === 0) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  private paint(): void {
    const views = this.queue.views();
    const live = new Set(views.map((v) => v.toast.id));
    for (const [id, el] of this.els) {
      if (live.has(id)) continue;
      el.remove();
      this.els.delete(id);
    }
    for (const { toast, faded } of views) {
      let el = this.els.get(toast.id);
      if (!el) {
        el = this.root.createDiv({ cls: "kh-brain-toast" });
        el.createSpan({ cls: "kh-brain-toast-dot" });
        el.createSpan({ cls: "kh-brain-toast-text" });
        el.addEventListener("pointerenter", () => this.queue.hover(toast.id, true, Date.now()));
        el.addEventListener("pointerleave", () => this.queue.hover(toast.id, false, Date.now()));
        el.addEventListener("click", () => this.open(toast.path));
        this.els.set(toast.id, el);
      }
      const text = toastText(toast);
      const t = el.querySelector<HTMLElement>(".kh-brain-toast-text")!;
      if (t.textContent !== text) t.setText(text);
      el.setAttr("title", `./${toast.path}`);
      el.toggleClass("is-faded", faded);
      el.setCssProps({ "--kh-brain-agent-color": toast.color });
      this.root.appendChild(el); // keeps DOM order = queue order (oldest first, newest at the bottom)
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
    this.root.remove();
  }
}
