import { ItemView, type WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type KyleTermPlugin from "./main";

export const VIEW_TYPE = "kyle-term-view";

export class KyleTermView extends ItemView {
  private term: Terminal | null = null;
  private ro: ResizeObserver | null = null;
  private sessionId: string | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: KyleTermPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "kyle-term"; }
  override getIcon(): string { return "terminal"; }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("kyle-term-root");

    const mgr = this.plugin.getManager();
    if (typeof mgr === "string") {
      root.createDiv({ cls: "kyle-term-message", text: mgr });
      return;
    }

    const term = new Terminal({
      fontFamily: "Consolas, 'Cascadia Mono', monospace",
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    this.term = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(root);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch {
      // fall back to the default renderer
    }
    fit.fit();

    const id = mgr.spawnSession(
      { shell: "powershell.exe", args: ["-NoLogo"], cwd: this.plugin.vaultRoot(), cols: term.cols, rows: term.rows },
      {
        onData: (d) => term.write(d),
        onExit: (code) => term.write(`\r\n[process exited with code ${code}]\r\n`),
      },
    );
    this.sessionId = id;
    term.onData((d) => mgr.write(id, d));
    term.onResize(({ cols, rows }) => mgr.resize(id, cols, rows));

    this.ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* not visible */ }
    });
    this.ro.observe(root);
    term.focus();
  }

  override async onClose(): Promise<void> {
    this.ro?.disconnect();
    this.ro = null;
    const mgr = this.plugin.getManager();
    // Phase 1: single session tied to the view; Phase 2 moves session lifetime fully to the plugin.
    if (this.sessionId && typeof mgr !== "string") mgr.kill(this.sessionId);
    this.sessionId = null;
    this.term?.dispose();
    this.term = null;
  }
}
