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

## 4.2 Board — LOCK-18

1. All Issues → header toggle **Board** (or Display → Layout) → one column per workflow status in order (empty status columns shown), correct counts; board scrolls horizontally, columns vertically. The choice persists per view.
2. Drag a card Todo → In Progress: it lands where dropped, the file's `status` changes, and an activity line is appended.
3. Display: group by Project, sub-group by Priority → collapsible swimlanes with counts. Drag a card to another project lane and column → both fields update. Drag into "No project" → `project` is cleared.
4. Group by Label → dragging moves the dragged-from label to the target label.
5. Ordering Manual → reorder within a column, reload Obsidian → order kept. With any other ordering, in-column reorder is disabled and a hint bar says so.
6. A single click on a card opens the ticket; a drag does not. Cards show ID + assignee initial, 2-line title, enabled chips.
7. Column "+" opens New issue preset to that column's value.
8. Smoothness: with 300+ issues (create via console loop: `for (let i=0;i<300;i++) await app.plugins.plugins['kyle-tickets'].store.createIssue({title:'Load '+i})`), dragging stays smooth. Delete them afterwards.
9. Light and dark themes: drag overlay raised, drop targets highlighted.

## 5.1 Filter bar — LOCK-19

1. Click **Filter** → Status → tick Todo and In Progress → chip "Status is any of Todo, In Progress" appears; List and group counts update live.
2. Add Label → bug → only issues matching both conditions appear, in List and Board.
3. Click the label chip's operator → "is not any of" → results invert for that condition.
4. Click a chip's values to change them; ✕ removes the chip; **Clear** removes all. Picking a field that already has a chip edits that chip.
5. "No project", "No assignee", "No milestone", "No label" and "No priority" are selectable and work.
6. Due date → Overdue → only past-due, not-completed issues. Also try Due today, this week (Mon–Sun), this month, No due date.
7. Switch to another sidebar view and back → each view keeps its own filters. Restart Obsidian → filters persist.
8. Narrow the pane below ~560px → chip bar hides and a count badge appears on the Filter button.

## 5.2 Keyboard shortcuts and settings editors — LOCK-20

1. All Issues → click empty space in the view → `J` a few times: highlight moves and scrolls into view. `K`, ↓/↑, `Enter` (opens the ticket) and `Esc` (clears) work. On Board, `J`/`K` walk cards column by column.
2. With an issue selected: `S` → Done changes its status; `P`, `L`, `A` open their pickers anchored to the row/card. `C` opens New issue (preset to the project in a project view).
3. `F` opens the filter menu; typing `c` in its search does not open New issue. `Ctrl+Shift+B` toggles List/Board. With a note focused, Obsidian's own hotkeys are unaffected.
4. Settings → kyle-tickets → Statuses: rename "In Review" → "Review": confirmation shows a count; afterwards the board column is renamed and each affected file has an activity line.
5. Add status "Blocked" (category Started, red), drag it between In Progress and Review: board column order follows.
6. Deleting the default status is refused; deleting a used status asks where to move its issues. Make another status the default.
7. Labels: change the "bug" color → chips update in open views immediately. Rename a label (confirmation + count) and delete one; check the ticket files.
8. Rename a status used by more than 20 issues → a progress notice appears.

## 6.1 Issue page — LOCK-21

1. Click a row or card in the main view → the Linear-style issue page opens in the tab. Opening the same ticket from the file explorer, a `[[TIX-12]]` link or the quick switcher gives the same page. A normal note opens in the normal editor.
2. Header breadcrumb reads `Project › TIX-12` (sub-issue: `› TIX-3 Parent title ›` too). Clicking the project opens its note; clicking the parent opens the parent issue.
3. Click the title, edit, Enter → saved; blur → saved; Esc → cancelled. Tab title shows `TIX-12 Title`.
4. Sidebar: Status, Priority, Assignee, Labels, Project, Milestone, Due date each open their picker; the raw file's frontmatter changes and activity lines are appended. Changing project clears the milestone. Created/Updated show relative time with full date on hover.
5. With focus on the page, `S`/`P`/`L`/`A` open the pickers; `Esc` goes back to the previous view.
6. **Open as Markdown** → raw editor in the same tab with an "Open as issue" header button → back. Command "kyle-tickets: Toggle issue / Markdown view" does the same.
7. "…" menu: Copy link; Delete issue (asks for confirmation) → page shows "This issue was deleted".
8. Add a PR URL to `pullRequests` in the raw file → listed under Pull requests.
9. Restart Obsidian with an issue tab open → it reopens as the issue page (a tab forced to Markdown also reopens as the issue page).
10. With the page open, edit `priority:` in the raw file in another pane → the sidebar updates within about a second.
11. With another plugin that patches leaves (e.g. Kanban) installed, disable and re-enable kyle-tickets → files open normally while disabled, issue page again after re-enabling.

## 6.2 Issue page description, sub-issues, activity and comments — LOCK-22

1. Open an issue, click the description, type a few lines including `[[SomeNote]]`, click away → it renders and the link opens the note. `Esc` and `Ctrl+Enter` also save. Raw file: frontmatter and `## Activity` unchanged, `updated` bumped.
2. Empty description shows a muted "Add description…" placeholder. Embeds, tasks and code blocks render.
3. `C` on the issue page (or "+ Add sub-issue") opens New issue with the parent preset. Add two sub-issues → listed with "0/2"; change one's status from its icon → count updates. Clicking a sub-issue opens it.
4. Post a multi-line comment with a code block and a line starting with `### ` via `Ctrl+Enter`, then another via the button → each shows as a card (avatar initial, rendered Markdown, full time on hover). Raw file shows `### @<name> · <time>` with the body's `###` line escaped as `\###`.
5. Change status or add a label from the sidebar → feed shows "@kyle changed status from Todo to In Progress"-style lines.
6. In a terminal, append `### @claude · 2026-11-21 12:00` plus a body to the ticket file → appears on the page within about a second.
7. Issue with 50+ feed entries → "Show earlier" button appears; scrolling stays smooth.
8. Description editor and comment box look Obsidian-native in light and dark themes (Markdown highlighting, no console errors about duplicate CodeMirror instances).

## 7.1 Project pages — LOCK-23

1. Sidebar → **+** next to Projects → create "Website" with icon, color, status and target date → it appears in the sidebar and `Projects/Website.md` exists.
2. Click it → project page in the main view content area: edit title, description, status, lead, target date, color and icon inline. Progress bar = completed / (total − canceled). (Since LOCK-24 the project's issues are embedded below the milestones; there is no "View issues" button.)
3. Rename it to "Web" via the title → file renamed; an issue's `project:` reads `[[Web]]` (try with Obsidian's "Automatically update internal links" both on and off).
4. "…" → Delete, confirm → file trashed; its issues lose `project` (and `milestone`) with activity lines.
5. Open a project file from the file explorer → project page. "…" → Open as Markdown → raw file; header button "Open in kyle-tickets view" switches back.
6. On an issue page, click the breadcrumb project → project page opens.
7. Set a project to Completed or Canceled → it moves under "Archived" in the sidebar. Sidebar shows icons and colors, ordered by status then name; status icons are Linear-style (dashed, empty, half, pause, check, x).
8. Invalid or duplicate names (`a/b`, an existing name) → notice; nothing created or renamed.

## 7.2 Milestones and project issues — LOCK-24

1. Project "Web" → Milestones → **+** → add "Alpha" (target next week) and "Beta" (next month). Drag Beta above Alpha; the order persists after reload.
2. Assign three issues to Alpha and mark one Done → Alpha shows 1/3 · 33% with a mini bar (canceled issues don't count toward the total).
3. Give a milestone with open issues a past target date → it's highlighted as overdue.
4. Project page issues section (below milestones; default grouping Status): switch to Board, group by Milestone → columns in milestone order, "No milestone" last. Drag a card Alpha → Beta → its milestone changes. Display/filter state is separate from the main view's.
5. Click Alpha's name → a Milestone filter chip appears; click again → it clears.
6. Milestone "…" → Edit → rename Alpha → "Alpha 1" → its issues follow.
7. Open an issue, change its project → milestone clears with an activity line.
8. Delete a milestone that has issues → confirmation; issues lose the milestone with activity lines.
9. New issue window: pick a project → the Milestone picker lists only that project's milestones.
10. Open the project file from the file explorer → same milestones and issues.
11. Main view List/Board/Display/Filter behave exactly as before (IssueCollection refactor; collapsed groups still remembered).
