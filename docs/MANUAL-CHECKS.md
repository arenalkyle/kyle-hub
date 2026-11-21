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
