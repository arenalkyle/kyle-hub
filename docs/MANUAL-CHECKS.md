# Manual checks

Checks that need a person using Obsidian, one section per ticket. Vault: the one in `.env.local`. Run `npm run deploy` first, then reload Obsidian (or toggle the plugin).

## 1.1 Scaffold — LOCK-11

1. `npm i` → make sure `.env.local` exists → `npm run deploy`.
2. Obsidian → Settings → Community plugins → enable **kyle-tickets**. No error notice; the dev console (Ctrl+Shift+I) shows `kyle-tickets loaded`.
3. Disable it again. No errors in the console.
4. Optional: `npm run dev`, save any file under `src/`, and confirm it rebuilds and prints `deployed -> …`.

## 1.2 Core model — LOCK-12

No Obsidian checks (pure module). Optional: skim `src/core/core.test.ts` to confirm the ticket file format (frontmatter, `## Activity`, `### @author · YYYY-MM-DD HH:mm` comments, `- YYYY-MM-DD HH:mm · @author text` events) is what you expect agents to write.

## 2.1 Plugin shell — LOCK-13

1. In the vault (no `Tickets/` yet), enable the plugin → the setup window appears (folder with suggestions, prefix, display name). Try an invalid prefix like `ab1` → it's rejected. Accept the defaults.
2. `Tickets/Issues/`, `Tickets/Projects/`, `Tickets/All Issues.base` and `Tickets/.kyle-tickets.json` appear. Open `All Issues.base` → it renders an empty table with columns id, title, status, priority, project, due, tags, created.
3. Click the ribbon icon (kanban-square, tooltip "kyle-tickets") twice → only one kyle-tickets tab, showing a React heading.
4. Run **kyle-tickets: Open kyle-tickets** → reveals the same tab. Run **kyle-tickets: New issue** → "coming in 3.1" notice.
5. Settings → kyle-tickets: change the display name, reload Obsidian → it persists and the setup window does not reappear.
6. Change the folder in settings to a new name and click away → it offers to create the structure there (nothing is moved). Change it back.
7. Disable and re-enable the plugin → no console errors.
