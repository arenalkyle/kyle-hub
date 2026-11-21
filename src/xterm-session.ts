import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TermHandlers, TermLike } from "./session-manager";
import { decideKey } from "./keys";
import { clampFont, type XtermTheme } from "./appearance";

export interface TermLook {
  theme: XtermTheme;
  fontFamily: string;
  fontSize: number;
  webgl: boolean;
}

/** One long-lived xterm per session; its element is moved between views, never recreated. */
export class XtermSession implements TermLike {
  private term: Terminal;
  private fitAddon = new FitAddon();
  private serializer = new SerializeAddon();
  private el = document.createElement("div");
  private opened = false;
  private gl: WebglAddon | null = null;
  /** Per-session zoom; null = follow the setting. Not persisted. */
  private zoom: number | null = null;

  constructor(h: TermHandlers, private look: () => TermLook, private onDispose?: (t: XtermSession) => void) {
    const l = look();
    const term = new Terminal({
      fontFamily: l.fontFamily,
      fontSize: l.fontSize,
      theme: l.theme,
      allowTransparency: true,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    this.term = term;
    term.loadAddon(this.fitAddon);
    term.loadAddon(this.serializer);
    term.onData(h.onInput);
    term.onResize(({ cols, rows }) => h.onResize(cols, rows));
    term.onTitleChange(h.onTitle);
    term.onBell(h.onBell);
    this.el.className = "kyle-term-term";
    this.el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.pasteClipboard();
    });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = e.key.toLowerCase();
      // Let Obsidian hotkeys (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+Shift+T) bubble.
      // Alt+A: jump to next session needing attention.
      if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && k === "a") return false;
      if (e.ctrlKey && !e.altKey && (k === "tab" || (e.shiftKey && k === "t"))) return false;
      const action = decideKey(e, process.platform, term.hasSelection());
      if (action === "zoom-in" || action === "zoom-out" || action === "zoom-reset") {
        e.preventDefault();
        const cur = this.zoom ?? this.look().fontSize;
        this.zoom = action === "zoom-reset" ? null : clampFont(cur + (action === "zoom-out" ? -1 : 1));
        this.applyLook();
        return false;
      }
      if (action === "copy") {
        void navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (action === "paste") {
        e.preventDefault();
        this.pasteClipboard();
        return false;
      }
      if (action === "newline") {
        e.preventDefault();
        h.onInput("\x1b\r");
        return false;
      }
      return true;
    });
  }

  paste(text: string): void { this.term.paste(text); }

  private pasteClipboard(): void {
    void navigator.clipboard.readText().then((t) => { if (t) this.term.paste(t); }, () => {});
  }

  /** Re-read theme/font from settings (keeps this session's zoom) and re-fit. */
  applyLook(): void {
    const l = this.look();
    this.term.options.theme = l.theme;
    this.term.options.fontFamily = l.fontFamily;
    this.term.options.fontSize = this.zoom ?? l.fontSize;
    this.syncWebgl();
    this.fit();
  }

  get cols(): number { return this.term.cols; }
  get rows(): number { return this.term.rows; }
  write(data: string): void { this.term.write(data); }
  serialize(lines: number): string { return this.serializer.serialize({ scrollback: lines }); }
  reset(): void { this.term.reset(); }
  dispose(): void { this.onDispose?.(this); this.el.remove(); this.term.dispose(); }
  focus(): void { this.term.focus(); }

  attach(parent: HTMLElement): void {
    parent.appendChild(this.el);
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.el);
      this.syncWebgl();
    }
    this.fit();
  }

  /** Load or dispose the WebGL addon to match the look; disposing falls back to the DOM renderer. */
  private syncWebgl(): void {
    if (!this.opened) return;
    if (this.look().webgl) {
      if (this.gl) return;
      try {
        const gl = new WebglAddon();
        gl.onContextLoss(() => { gl.dispose(); if (this.gl === gl) this.gl = null; });
        this.term.loadAddon(gl);
        this.gl = gl;
      } catch {
        this.gl = null; // fall back to the default renderer
      }
    } else if (this.gl) {
      this.gl.dispose();
      this.gl = null;
    }
  }

  fit(): void {
    if (!this.opened || this.el.clientWidth === 0) return;
    try { this.fitAddon.fit(); } catch { /* not visible */ }
  }
}
