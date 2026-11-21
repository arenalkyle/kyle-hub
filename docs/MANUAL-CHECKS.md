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
