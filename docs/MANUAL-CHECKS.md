# Manual checks

Things that need a person using Obsidian. Agents ran the automated checks (`npm run build`, `npm test`, `npm run deploy`) for every phase; these are the rest. Run `npm run deploy` first, then reload Obsidian.

## Phase 1 — First terminal (LOCK-2)

1. Enable kyle-term; a terminal icon appears on the left ribbon.
2. Click the ribbon icon from a note: a new tab opens and the note's tab stays.
3. Click it again from another tab: it switches to the kyle-term tab (no second tab).
4. PowerShell 5.1 starts in the vault root. Type `dir`, use arrow keys and history; colours render.
5. Run `claude` and send one prompt: layout is not garbled, input works.
6. Drag the pane wider and narrower, and resize the window: text reflows.
7. Set the Node path setting to a bogus path and reopen the view: a clear "install Node 18+ or set the path" message, no crash. Clear the setting afterwards.
8. Disable the plugin, then separately quit Obsidian: Task Manager shows no leftover `node.exe` / `powershell.exe` from kyle-term.
9. Run `npm run dev`, edit a file in `src/`, confirm it redeploys.

## Phase 2 — Sessions + sidebar (LOCK-3)

1. Open three sessions (two `+`, one `New Session`), switch between them; output is kept.
2. Rename one: pin icon shows and Claude's title no longer changes it. Clear the name: automatic title returns.
3. Close the kyle-term tab, reopen from the ribbon: all three still running.
4. Type `exit` in one: row stays greyed with exit code 0; Restart works in the same row; Close removes it.
5. Select text + Ctrl+C copies; Ctrl+C with no selection interrupts. Ctrl+V and right-click paste.
6. In `claude`, Shift+Enter inserts a newline (not a send).
7. Open 20+ sessions and scroll the sidebar. Drag the sidebar edge and collapse it; both are remembered after reopening.
8. Drag rows to reorder.
9. Row context menu: Rename, Colour tag (opens a second menu), Restart, Kill (asks to confirm), Copy working folder.
10. Commands: New terminal (Ctrl+Shift+T), Next/Previous session (Ctrl+Tab / Ctrl+Shift+Tab). If Ctrl+Tab clashes with Obsidian, rebind under Settings → Hotkeys.
11. Settings → Default shell profile lists pwsh / Git Bash only when installed; Claude start folder and Claude command are honoured by `New Session`.

## Phase 3 — Hooks + agent state (LOCK-4)

1. Run **kyle-term: Install hooks**, then open `~/.claude/settings.json`: old entries intact, kyle-term's added (incl. `PostToolUse`, `SubagentStart`), a timestamped backup next to it. Run Install again: no duplicates.
2. In a `New Session`, ask Claude to do a few tool calls: light goes working (blue pulse), activity line changes ("Editing …", "Running …"), then steady green on finish.
3. Ask for a command needing permission: light blinks red; after approving it returns to working.
4. Ask Claude to use 2 sub-agents in parallel: badge ⚙ 2, list shows both with spinners, then ✓ and fade.
5. Title shows Claude's first prompt when there is no manual name / terminal title.
6. Click another session and back: the red/green mark clears (note: an already-active session keeps its mark until you switch away and back).
7. Run `claude` in Windows Terminal: works normally, no errors.
8. A non-Claude CLI ringing the bell shows needs-input; a hookless session going quiet after typed input shows finished after the idle timeout (default 10 s).
9. Run **kyle-term: Uninstall hooks**: only kyle-term's entries are gone.

## Phase 4 — Sounds + attention (LOCK-5)

1. Settings → preview each built-in tone (Chime, Ping, Bell, Pulse) and a vault audio file at different master/event volumes (preview plays even when muted, by design).
2. Start a Claude session, switch to a note, trigger a permission prompt: urgent sound plays; status bar shows "⚠ 1 need you"; hover shows the title.
3. Press Alt+A from a note, from inside a terminal, and with the kyle-term tab closed: it jumps to the waiting session and the status bar clears. (If Alt+A clashes, rebind under Hotkeys.)
4. Let a turn finish while on a note: soft sound.
5. Stay on the session while it finishes: no sound.
6. Sidebar mute button, the mute setting and "Toggle mute" stay in sync, and survive an Obsidian restart.
7. Set a vault sound to a missing path: Chime plays and a notice appears once.

## Phase 5 — Appearance (LOCK-6)

1. Cycle each preset (Dracula, One Dark, Solarized Dark/Light); with Follow Obsidian, switch Obsidian light/dark and the terminal follows.
2. Custom → Start from Dracula, change two colours; they persist.
3. Font size 18 and an installed font family: applies live and the terminal re-fits.
4. Ctrl+= in one session: only that one grows (Ctrl+- / Ctrl+0 work; zoom resets on restart).
5. Set a vault background image, then an absolute Windows path with spaces; move all four sliders (image opacity, blur, dim, terminal opacity): smooth, no flicker, text readable, sidebar stays solid.
6. Terminal opacity < 100% switches to the DOM renderer (image shows through, text crisp); back at 100% WebGL returns.
7. A missing image path shows a notice and no image.
8. Restart Obsidian: everything is kept except per-session zoom.

## Phase 6 — Vault integration (LOCK-7)

1. File explorer: right-click a folder → "New Claude session here": Claude starts in that folder. Right-click a note → "Open terminal here": shell starts in the note's parent folder. The tab is revealed.
2. Settings → add a saved folder for a code repo (try a missing path: warning shown); reorder and remove work. Right-click `New Session` → pick it.
3. Right-click `New Session` → Continue last (starts `claude --continue`); Choose folder… (search works); Manage saved folders… opens the settings tab (uses private `app.setting`).
4. Select a multi-line paragraph → "Send selection to kyle-term" (editor menu and command): appears in Claude's prompt, not sent.
5. "Send note to kyle-term" on a note whose name has spaces: inserted as `@"path with spaces.md"`; confirm Claude actually reads it when you send. **(Unverified quoting form — if Claude can't read it, report it; the fix is one line in `buildRef`.)**
6. Drag two notes and a folder onto the terminal: `@` references appear, space-separated (uses private `app.dragManager`). Drag plain text: text is pasted.
7. Toggle the relative/absolute `@path` setting; a note outside the session folder is always absolute.
8. With no running session, Send note: a Claude session starts, waits until ready, then the reference is pasted.
9. Terminal has focus after send and drop.

## Phase 7 — Persistence (LOCK-8)

1. Open three sessions: one Claude with a short conversation, one plain shell, one renamed and colour-tagged.
2. Quit and reopen Obsidian; open kyle-term.
3. All three are listed as "stopped" with the right titles, colours and order; greyed history is visible with the "— session ended, restored from <time> —" divider; typing is ignored.
4. Click Resume on the Claude one: `claude --resume <id>` runs and the conversation continues below the history. Hook lights still work.
5. Click Restart on the shell one: fresh prompt in the same folder. (After a Resume, Restart runs the plain Claude command, not the resume.)
6. Remove one, restart Obsidian again: it stays gone (and its `sessions/<id>.txt` file is deleted).
7. Turn off "Restore scrollback": saved files under the plugin's `sessions/` folder are deleted; metadata and Resume still work.
8. Delete/rename a session's folder, then Resume/Restart: starts in the vault root with a notice.
9. Kill Obsidian from Task Manager mid-session, reopen: at most a few seconds of state lost.
