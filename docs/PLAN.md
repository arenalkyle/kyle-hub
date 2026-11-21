# kyle-term — Plan

An Obsidian plugin that embeds real terminals in a dedicated tab, built for running AI coding agents (Claude Code first-class, other CLIs best-effort) alongside an Obsidian vault. Inspired by [Terminus](https://github.com/notenerdofficial/terminus) (MIT) for UI ideas only — Terminus is Unix-only, so the PTY layer is new.

Status dashboard: [`../STATUS.md`](../STATUS.md). Decisions: [`ADR/`](ADR/).

## Goals

- Windows 10 first-class; macOS best-effort; Linux not targeted (not blocked).
- Personal use; public MIT repo; no personal paths in code.
- Requires Node ≥ 18 on PATH (or configured) and Claude Code.

## Architecture

```
Obsidian (renderer)                         System Node (child process)
┌──────────────────────────────┐  stdio    ┌───────────────────────────┐
│ KyleTermView (single tab)    │  JSON     │ helper/pty-host.js        │
│  ├ Sidebar (sessions)        │◄────────► │  @lydell/node-pty         │
│  └ xterm.js (active session) │  lines    │  (ConPTY on Win, forkpty) │
│ SessionManager (plugin-owned)│           └───────────────────────────┘
│ HookServer 127.0.0.1:<port>  │◄── HTTP POST (token) ── hooks/kyle-hook.js
│ SessionStateMachine          │        (run by Claude Code hooks, only
│ Sounds / StatusBar / Settings│         when KYLE_TERM_SESSION is set)
└──────────────────────────────┘
```

- **PTY**: helper process on system Node using prebuilt `@lydell/node-pty`; no Electron-ABI rebuilds. See [ADR-0001](ADR/0001-pty-helper-process.md).
- **Renderer**: `@xterm/xterm` v6 + `addon-fit`, `addon-webgl` (canvas fallback), `addon-serialize`.
- **Agent state**: Claude Code hooks → local HTTP server; bell + idle heuristic fallback. See [ADR-0002](ADR/0002-hook-transport.md).
- **Session ownership**: sessions belong to the plugin, not the view. Closing the tab keeps shells alive; ✕ or plugin unload kills them (confirm if any agent is working).

## Feature spec

### Tab & ribbon
- Ribbon icon opens the kyle-term view in a **new tab**; if one exists, reveal it instead (single instance).
- One terminal visible at a time (splits are v2).

### Sidebar
- Left sidebar inside the tab, resizable, collapsible, vertically scrollable.
- Header: `New Session` button, `+` button, mute toggle.
  - `New Session` → launches Claude: default shell, setting **Claude start folder** (default vault root), setting **Claude command** (default `claude`).
  - Right-click `New Session` → *Continue last* (`--continue`), *Choose folder…*, saved folders.
  - `+` → plain terminal, default shell, vault root.
- Row layout:
  ```
  ● Refactor PTY bridge        ⚙2  12m
    Editing src/pty/host.ts
    ├ ⟳ Explore: find hook refs
    └ ✓ Plan: phase outline
  ```
  light · title · sub-agent count · time since activity; activity line; collapsible sub-agent list (finished rows fade after N s).
- Drag to reorder. Context menu: Rename, Color tag, Restart, Kill, Copy cwd.
- **Title priority**: manual rename (pinned icon) > OSC terminal title (Claude sets one) > first prompt (truncated) > profile name.
- Exited sessions **never auto-close**: greyed out, exit code shown, Restart / Close actions.

### Shells
- Profiles: Windows — PowerShell 5.1 (default), pwsh 7 (if found), Git Bash, cmd. macOS — bash (`bash -l`, default), zsh.
- Default shell setting; per-session cwd.

### Agent state & attention
- Each PTY gets env `KYLE_TERM_SESSION`, `KYLE_TERM_PORT`, `KYLE_TERM_TOKEN`.
- Hook events → state:
  | Hook | Effect |
  |---|---|
  | `SessionStart` | store Claude `session_id` (for resume) |
  | `UserPromptSubmit` | state = working; first prompt feeds title fallback |
  | `PreToolUse` (all) | activity line (throttled); Agent/Task tool → add sub-agent row (type, description) |
  | `SubagentStop` | mark sub-agent done |
  | `Notification` | state = **needs-input** |
  | `Stop` | state = **finished** |
- Fallback for non-Claude CLIs: terminal bell + idle detection → needs-input.
- **Needs-input**: blinking red light + urgent sound. **Finished**: steady green + soft sound. Cleared on viewing that session. No sound if that session is visible and Obsidian is focused.
- Status-bar badge "N need you"; hotkey jumps to next attention session.

### Hooks installer
- Command **Install kyle-term hooks**: backs up `~/.claude/settings.json`, additively merges hook entries pointing to `<plugin>/hooks/kyle-hook.js`. **Uninstall** removes only our entries.
- Hook script is a no-op unless `KYLE_TERM_SESSION` is set → zero impact on Claude sessions outside kyle-term.

### Sounds
- Per-event sound (needs-input, finished, sub-agent done [off by default]).
- Source: built-in WebAudio tones (chime, ping, bell, pulse) or any vault audio file.
- Master volume, per-event volume, mute toggle, preview button.

### Appearance
- Theme presets (Follow Obsidian, Dracula, Solarized Dark/Light, One Dark, Custom) with editable ANSI palette.
- Font family, font size; per-session zoom (Ctrl/Cmd +/-).
- Background image (vault file or absolute path) with sliders: image opacity, blur, dim; terminal background opacity (transparent xterm canvas over image).

### Keys
- Ctrl+C: copy if selection else SIGINT (macOS: Cmd+C copy, Ctrl+C SIGINT). Ctrl+V / right-click paste (Cmd+V on mac).
- Shift+Enter → newline (Claude Code multiline).
- Commands (rebindable in Obsidian Hotkeys): New terminal (Ctrl+Shift+T), Next/prev session (Ctrl+Tab / Ctrl+Shift+Tab), Next attention session (Alt+A).

### Vault integration
- File-explorer context menu on folder/note: **Open terminal here**.
- **Send to agent**: selection or current note → active session as `@path` reference.
- Drag a note from the explorer onto the terminal → inserts `@path`.

### Persistence
- Persist session metadata (title, cwd, profile, color, order, Claude `session_id`).
- On restart, dead sessions show last 2000 lines (serialize addon; setting to disable) greyed, with **Resume** (`claude --resume <id>`).

### macOS specifics
- Resolve PATH from login shell once (`$SHELL -ilc 'echo $PATH'`); fallback includes `/opt/homebrew/bin`; **Node path** setting override.
- Cmd-based copy/paste.

## Repo layout (target)

```
kyle-term/
  src/            plugin (TypeScript)
  helper/         pty-host.js (runs on system Node)
  hooks/          kyle-hook.js
  tests/          vitest
  scripts/        deploy.mjs
  docs/           PLAN.md, ADR/
  STATUS.md  README.md  CLAUDE.md  LICENSE
```

## Build & deploy

- esbuild bundle → `main.js`. `npm run deploy` builds and copies `main.js`, `manifest.json`, `styles.css`, `helper/`, `hooks/`, and the helper's `node_modules` (native prebuild) into `<vault>/.obsidian/plugins/kyle-term/` for each path in git-ignored `.env.local` → `KYLE_TERM_VAULTS=C:\path\vaultA;C:\path\vaultB` (`:`-separated on mac also accepted).
- `npm run dev` = watch + deploy.
- Native binary arrives via `npm install` on each machine (platform-specific optional deps).
- Setup steps for humans and agents live in `README.md` and `CLAUDE.md`.

## Testing

- **Vitest**: session state machine, hook installer JSON merge, title priority, helper protocol encode/decode.
- **Integration**: spawn real helper → echo round-trip through ConPTY.
- **Manual checklist** per phase (UI); Windows 10 every phase, macOS when available.

## Phases

Each phase splits into two sub-phases (N.1, N.2), each sized for one sub-agent to complete in one context. Executed in series.

1. **Scaffold & first terminal**
   - 1.1 Repo scaffold (manifest, esbuild, TS strict, vitest, deploy script, README/CLAUDE.md setup steps, LICENSE, GitHub repo); ribbon + single-instance view.
   - 1.2 Helper process + JSON protocol, node path resolution, xterm render of one PowerShell session with resize; integration test.
2. **Sessions & sidebar**
   - 2.1 SessionManager (plugin-owned lifecycle, profiles, exit handling, never auto-close), sidebar list with scroll/resize/collapse, `New Session` / `+`.
   - 2.2 Rename + title priority (OSC), context menu, drag reorder, color tags, keys (copy/paste/Shift+Enter, session commands).
3. **Hooks & agent state**
   - 3.1 HookServer (token, port), kyle-hook.js, installer/uninstaller with backup; tests.
   - 3.2 State machine, lights, activity line, sub-agent rows, bell/idle fallback; tests.
4. **Attention & sounds**
   - 4.1 WebAudio tones + vault file playback, per-event/master volume, mute, preview, focus suppression.
   - 4.2 Status-bar badge, next-attention hotkey, clear-on-view.
5. **Appearance**
   - 5.1 Theme presets + custom ANSI palette, font family/size, per-session zoom.
   - 5.2 Background image, opacity/blur/dim sliders, terminal opacity.
6. **Vault integration**
   - 6.1 Open terminal here (file menu), `New Session` right-click menu (continue, choose folder, saved folders).
   - 6.2 Send to agent (`@path`), drag-and-drop notes onto terminal.
7. **Persistence**
   - 7.1 Persist session metadata + Claude session_id; restore sidebar on load.
   - 7.2 Scrollback serialize/restore (2000 lines), Resume action.
8. **macOS pass**
   - 8.1 Login-shell PATH resolution, `/opt/homebrew/bin` fallback, bash/zsh profiles, Cmd key mappings.
   - 8.2 Mac smoke test, README mac section, fixes.

## Out of scope (v1)

- Session notes (vault "brain" handles knowledge capture separately).
- Split panes, sidebar groups, release zips / GitHub Action.
- Community-plugin distribution.
- Vault "brain" design (tickets/docs/ADRs/wiki/CLAUDE.md routing) — separate grilling session.
