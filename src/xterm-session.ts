import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TermHandlers, TermLike } from "./session-manager";

/** One long-lived xterm per session; its element is moved between views, never recreated. */
export class XtermSession implements TermLike {
  private term: Terminal;
  private fitAddon = new FitAddon();
  private el = document.createElement("div");
  private opened = false;

  constructor(h: TermHandlers) {
    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    this.term = term;
    term.loadAddon(this.fitAddon);
    term.onData(h.onInput);
    term.onResize(({ cols, rows }) => h.onResize(cols, rows));
    term.onTitleChange(h.onTitle);
    this.el.className = "kyle-term-term";
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.paste();
    });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = e.key.toLowerCase();
      // Let Obsidian hotkeys (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+T) bubble.
      if (e.ctrlKey && !e.altKey && (k === "tab" || (e.shiftKey && k === "t"))) return false;
      if (e.ctrlKey && !e.altKey && !e.shiftKey && k === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (e.ctrlKey && !e.altKey && k === "v") {
        e.preventDefault();
        this.paste();
        return false;
      }
      if (k === "enter" && e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        h.onInput("\x1b\r");
        return false;
      }
      return true;
    });
  }

  private paste(): void {
    void navigator.clipboard.readText().then((t) => { if (t) this.term.paste(t); }, () => {});
  }

  get cols(): number { return this.term.cols; }
  get rows(): number { return this.term.rows; }
  write(data: string): void { this.term.write(data); }
  reset(): void { this.term.reset(); }
  dispose(): void { this.el.remove(); this.term.dispose(); }
  focus(): void { this.term.focus(); }

  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.el);
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => gl.dispose());
        this.term.loadAddon(gl);
      } catch {
        // fall back to the default renderer
      }
    }
    this.fit();
  }

  fit(): void {
    if (!this.opened || this.el.clientWidth === 0) return;
    try { this.fitAddon.fit(); } catch { /* not visible */ }
  }
}
