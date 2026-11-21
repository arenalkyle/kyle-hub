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

## 2.2 IssueStore — LOCK-14

1. Dev console (Ctrl+Shift+I): `app.plugins.plugins['kyle-tickets'].store.createIssue({ title: 'Test' })` → `Tickets/Issues/TIX-1.md` appears with frontmatter and a "created the issue" event; the main view shows "1 issues".
2. Open `TIX-1.md` in source mode, change `status: Backlog` to `status: Todo`, wait ~1 s → exactly one `- … · @external set status: Backlog → Todo` line is appended (no repeats).
3. Delete the file → count goes to 0. Create another issue → it is `TIX-2` (numbers not reused).
4. Rename an issue file in the explorer → the count stays the same and nothing is appended.

## 3.1 Pickers and New issue window — LOCK-15

1. Settings → Hotkeys: assign a hotkey to **kyle-tickets: New issue**; press it → the Linear-style window opens (title, description, property buttons, "Create more", **Create issue**).
2. Enter a title, pick status Todo, priority High, create a new label "bug" (it gets a coloured dot), choose a project if one exists (Milestone enables only then), due date → Tomorrow → `Ctrl+Enter`. A "Created TIX-N" notice appears; its link opens the file; frontmatter matches what you picked.
3. Keyboard only: open each picker, type to filter, ↑/↓, `Enter` to choose, `Esc` to close. **Esc inside a picker must close only the picker, not the whole window.** Picker popovers must render above the modal.
4. Assignee: type a free-text name → accepted; reopen → recent names listed. Parent picker: search by ID and by title; "No parent" clears it.
5. Toggle "Create more" → after creating, the window stays open with title/description cleared and other properties kept.
6. Switch light/dark theme → icons, chips and popovers stay readable.

## 3.2 Main view sidebar and List view — LOCK-16

1. Create about 6 issues across several statuses and priorities, two of them in a project (create the project via the console if needed: `app.plugins.plugins['kyle-tickets'].store.createProject({ name: 'Demo' })`).
2. Open kyle-tickets → left sidebar shows All Issues, Active, Backlog, then Projects. All Issues lists groups in status order (Triage → Duplicate) with correct counts; empty groups are hidden. Active hides Backlog/Done; the project entry shows only its issues.
3. Rows: priority icon · ID · status icon · title · chips (coloured labels, project, due — red when overdue, assignee, created). Click a row → opens the file; Ctrl+click → new tab.
4. Click a row's status icon → pick a new status → the row moves to the right group and the file gets an activity event. Same for the priority icon.
5. Group header "+" → New issue preset to that status (and project, in a project view). Header **New issue** works; List|Board toggle disabled; Filter/Display are placeholders.
6. Collapse a group, drag the sidebar edge wider, select a project view, reload Obsidian → selection, width and collapsed group persist. The header toggle hides/shows the sidebar.
7. Empty view shows "No issues" + New issue button. Check light and dark themes.

## 4.1 Display popover — LOCK-17

1. Header → **Display**: Grouping = Priority, Sub-grouping = Project → indented sub-sections with their own headers and correct counts (Urgent → Low → No priority; projects alphabetical, "No project" last).
2. Ordering = Due date → earliest first, no-due last.
3. Completed issues = None → Done/Canceled disappear; Past week → only recently completed remain.
4. Turn off the Labels and Created chips → rows update immediately.
5. Show sub-issues off → child issues hide and the parent row shows "N sub-issues".
6. Group "+" in a Priority/Project group → New issue is preset with that priority/project.
7. Set All Issues and Active to different groupings, restart Obsidian → each is remembered. **Reset** restores defaults.
8. Dropdown pickers inside the popover open above it without closing it.
