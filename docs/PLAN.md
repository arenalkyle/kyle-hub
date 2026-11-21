# kyle-tickets — Plan

An Obsidian plugin that brings a Linear-style issue tracker into a vault: an All Issues view with List and Board layouts, grouping and sub-grouping, Linear's issue page, projects with milestones, comments that agents can write, and GitHub PR status. Tickets are plain Markdown files, so humans, Obsidian and AI agents can all read and edit them.

Status dashboard: [`../STATUS.md`](../STATUS.md). Decisions: [`ADR/`](ADR/). Terms: [`../GLOSSARY.md`](../GLOSSARY.md).

## Goals

- **Windows 10 only**, desktop only (`isDesktopOnly: true`). Node APIs are allowed. macOS/Linux/mobile are not targeted.
- Personal use. Public MIT repo, **not** submitted to the community store, no GitHub releases. No personal paths in source.
- Look and behave as close to Linear as is reasonable, styled with Obsidian CSS variables so it follows the user's theme.
- Files are the source of truth ([ADR-0001](ADR/0001-files-are-source-of-truth.md)).

## Stack

- TypeScript (strict), **React 18**, esbuild, `obsidian` API. [ADR-0003](ADR/0003-react-ui.md).
- `@dnd-kit/core` + `@dnd-kit/sortable` for Board and manual ordering.
- `@codemirror/*` (CM6) for the description editor.
- Vitest for `src/core/` (pure, no Obsidian imports).
- Build: `npm run build` (tsc --noEmit + esbuild), `npm run dev` (watch), `npm run deploy` copies `main.js`, `manifest.json`, `styles.css` into each vault in `.env.local` → `KYLE_TICKETS_VAULTS=<path>[;<path>]` at `<vault>/.obsidian/plugins/kyle-tickets/`. Default dev vault: `C:\Development\locked-away` (set only in `.env.local`, never in source).
- CI (GitHub Actions): `npm ci`, `npm run build`, `npm test` on push. No release workflow.

## Architecture

```
src/
  core/        pure TS, no Obsidian imports; unit-tested; shared with the kt CLI
    types.ts        Issue, Project, Milestone, Status, Priority, Comment, ActivityEvent, Settings
    issueFile.ts    parse/serialize ticket files (frontmatter + description + ## Activity)
    projectFile.ts  parse/serialize project files
    ids.ts          ID allocation (prefix + counter, max(existing)+1 guard)
    query.ts        filter, group, sub-group, order (pure functions over Issue[])
    defaults.ts     default statuses, priorities, settings
  store/
    IssueStore.ts   indexes the vault folder, watches changes, write API, activity diffing
  views/
    MainView.tsx    ribbon target: sidebar + List/Board
    IssueView.tsx   Linear issue page for a ticket file
    ProjectView.tsx project page
    components/     pickers, chips, Display popover, filter bar, cards, rows
  settings/        settings tab + setup modal
  github/          gh CLI runner + PR cache
  main.ts          plugin entry: ribbon, commands, view registration, file-open interception
cli/kt.ts          Node CLI over src/core (built to cli/kt.js)
```

`IssueStore` is the only module that writes ticket files from the plugin. Views subscribe to it (a small event emitter + React hook `useIssues()`).

## Data model

### Vault layout (folder chosen at setup, default `Tickets/`)

```
Tickets/
  Issues/TIX-1.md, TIX-2.md, ...
  Projects/<Project Name>.md
  All Issues.base          generated bonus view (native Bases)
  AGENTS.md                file-format guide for agents (Phase 9)
```

### Ticket file — `Issues/TIX-12.md`

```md
---
id: TIX-12
title: Fix login bug
aliases: [Fix login bug]
status: In Progress
priority: high
assignee: claude
project: "[[kyle-tickets]]"
milestone: Phase 1
tags: [bug, frontend]
due: 2026-12-01
parent: "[[TIX-3]]"
pullRequests:
  - https://github.com/owner/repo/pull/4
created: 2026-11-21T10:04:00
updated: 2026-11-21T10:31:00
updatedBy: kyle
sortOrder: 1000
---
Description in Markdown.

## Activity

- 2026-11-21 10:04 · @kyle created the issue
- 2026-11-21 10:20 · @kyle set status: Todo → In Progress

### @claude · 2026-11-21 10:31
Implemented the parser; tests in `src/core/issueFile.test.ts`.
```

Rules:
- File name is the ID only; the title lives in `title` and is mirrored into `aliases` so `[[Fix login bug]]` resolves. Renaming a title never renames the file.
- `priority`: `none | urgent | high | medium | low` (default `none`).
- `tags` are **labels**. Label colors live in plugin settings (auto-assigned on first sight).
- `parent` links make sub-issues. `project` links a project note; `milestone` is a milestone name from that project.
- Everything below the first `## Activity` heading is the activity feed. A **comment** is a `### @author · YYYY-MM-DD HH:mm` heading plus a Markdown body (until the next `###` or EOF). An **event** is a single bullet `- YYYY-MM-DD HH:mm · @author <text>`. Feed entries keep file order (chronological; new entries are appended). **Escaping**: when a comment is written, any body line starting with `###` or an event-bullet prefix (`- YYYY-MM-DD HH:mm `) gets one leading `\`; the parser removes one leading `\` from such lines, so bodies round-trip exactly and cannot break feed parsing.
- Unknown frontmatter keys and unknown body content are preserved on save (round-trip safe).
- Times are local time; `created`/`updated` ISO without zone.

### Project file — `Projects/<Name>.md`

```md
---
kind: kt-project
name: kyle-tickets
status: started
lead: kyle
target: 2026-12-31
color: "#5e6ad2"
icon: rocket
milestones:
  - name: Phase 1
    target: 2026-12-01
    description: Foundation
---
Project description in Markdown.
```

Project `status`: `backlog | planned | started | paused | completed | canceled`.

### Statuses

Default (editable in settings — add, rename, recolor, reorder, delete-with-reassign), each with a **category**:

| Status | Category |
|---|---|
| Triage | triage |
| Backlog *(default for new issues)* | backlog |
| Todo | unstarted |
| In Progress | started |
| In Review | started |
| Done | completed |
| Canceled | canceled |
| Duplicate | canceled |

The category drives the icon (Linear's dashed/empty/half/checked/✕ circles), "Active" (unstarted + started), and the "completed issues" display toggle (completed + canceled).

### IDs

`<prefix>-<n>`; prefix set at setup (default `TIX`). The counter lives in plugin data and only increases. On load and before every allocation it is raised to `max(existing n) + 1`, so files created outside the plugin (e.g. by the `kt` CLI) never collide. Deleted numbers are never reused.

### Plugin data (`data.json`)

Settings (folder, prefix, display name for `@author`, statuses, label colors, gh repos, PR refresh interval), the ID counter, per-view display/filter state, and the PR cache.

## Feature spec

### Setup & shell
- First enable → setup modal: folder (default `Tickets/`), ID prefix (default `TIX`), display name (default `kyle`). Creates `Issues/`, `Projects/`, `All Issues.base`. All changeable later in settings.
- Ribbon icon (`kanban-square`-style lucide icon) opens the main view (single instance; reveal if open).
- Commands: **Open kyle-tickets**, **New issue**, **Open as Markdown / Open as issue** (toggle for the active ticket).

### Main view
- Left sidebar: **All Issues**, **Active**, **Backlog**, then **Projects** (each project expands to its issues; a project click opens its page). "+" creates a project.
- Header: view title, **List | Board** toggle, **Filter**, **Display**, **New issue**.
- **List**: grouped sections with collapsible headers and counts; each row shows priority icon, ID, status icon, title, then right-aligned display-property chips (labels, project, milestone, due, PRs, assignee, created). Sub-issues optional.
- **Board**: one column per group; sub-grouping renders horizontal swimlanes. Cards (the "short preview card"): ID, title, status icon, priority, and enabled property chips. Dragging a card between columns/swimlanes updates the grouped property; dragging within a column with Manual ordering updates `sortOrder`.
- **Display popover** (saved per sidebar view): layout; grouping (Status, Priority, Project, Assignee, Label, Milestone, None); sub-grouping (same); ordering (Manual, Priority, Updated, Created, Due date); toggles: show sub-issues, completed issues (All / Past week / None), show empty groups; display-property chips: ID, Status, Priority, Project, Due date, Milestone, Labels, Created, Pull requests, Assignee.
- **Filter bar**: "+ Filter" adds AND-ed conditions on Status, Priority, Project, Label, Assignee, Milestone, Due (overdue / this week / none). Saved per view. No saved custom views in v1.
- **Keyboard** (only when a kyle-tickets view is focused): `C` new issue, `J/K` move selection, `Enter` open, `Esc` back/close, `S` status, `P` priority, `L` labels, `A` assignee, `Ctrl+Enter` post comment.

### Issue view (Linear issue page)
- Ticket files inside the folder open in `IssueView` instead of the Markdown editor (file-open interception like the Kanban plugin). Header button + command switch to raw Markdown and back. Files outside the folder are untouched.
- Main column: breadcrumb `Project › TIX-12` (+ parent link for sub-issues), large inline-editable title, description rendered with `MarkdownRenderer` (links/embeds work); click → CM6 Markdown editor, save on blur/`Esc`. **Sub-issues** list (status, ID, title, assignee) with "+ Add sub-issue". **Activity** feed: events as compact lines, comments as cards with author, relative time, rendered Markdown; comment box at the bottom.
- Right sidebar: Status, Priority, Assignee, Labels, Project, Milestone, Due date, Created, Updated, Pull requests — each opens the shared picker.

### Projects
- Project page: name/icon/color, status, lead, target date, editable description, milestone list with progress (done/total issues) and target dates, and the project's issues in List/Board with the same Display/Filter controls.
- Create/rename/delete projects and milestones from the UI.

### Activity diffing
- Writes through `IssueStore` append events (status, priority, assignee, project, milestone, labels, due, parent changes) attributed to the display name.
- External edits (frontmatter changed in the raw file or by an agent) are detected by diffing against the last indexed snapshot and logged as events attributed to `updatedBy` if present, else `@external`. Debounced; never loops on its own writes.

### Pull requests
- `pullRequests:` holds PR URLs. The properties sidebar lists them (repo#number, title, state); cards/rows show a PR chip with state color.
- Live state via the `gh` CLI (`gh pr view <url> --json number,title,state,isDraft,url`), run with `child_process.execFile`. Cached in plugin data; refreshed when an issue opens and every N minutes (setting). If `gh` is missing/unauthenticated, PRs show as plain links and settings shows why.
- Auto-link: for repos listed in settings, `gh pr list --repo <r> --state all --search "<PREFIX>-" --json ...` finds PRs whose title or branch contains an issue ID and adds them to that issue.

### Agent tooling
- `kt` CLI (Node, built from `cli/kt.ts`, uses `src/core`): `kt new "<title>" [--status] [--priority] [--project] [--parent] [--label ...]`, `kt set <ID> <field> <value>`, `kt comment <ID> --as <author> "<text>"`, `kt list [--status] [--project] [--json]`, `kt show <ID> [--json]`. Finds the tickets folder via `--dir`, `KT_DIR`, or a `.kyle-tickets.json` marker written at setup.
- `AGENTS.md` in the tickets folder (written at setup, regenerated on settings change) and a Claude Code skill in the repo describing the file format and CLI.

### Bases bonus
- `All Issues.base`: a table over `Issues/` with id, title, status, priority, project, due, tags, created. The plugin does not depend on it ([ADR-0002](ADR/0002-custom-views-over-bases.md)).

## Out of scope (v1)

Teams, cycles, estimates, blocking/related relations, notifications, saved custom views, label groups, mobile/macOS, community-store release, kyle-term "send to agent" integration.

## Phases

Each phase is split into two sub-phases (`N.1`, `N.2`); each sub-phase is one Linear sub-ticket worked by one Sonnet sub-agent, blocked by the previous sub-phase. Every sub-phase must leave `npm run build` and `npm test` passing.

### Phase 1 — Foundation
- **1.1 Scaffold**: package.json, tsconfig (strict), esbuild config (React/JSX, externals `obsidian`, `electron`, `@codemirror/*`, node builtins), vitest config, `manifest.json` (`id: kyle-tickets`, `isDesktopOnly: true`), `scripts/deploy.mjs` (reads `.env.local`), `.github/workflows/ci.yml`, minimal `main.ts` that loads and logs, `styles.css`. Done when `npm run deploy` installs a plugin that enables cleanly in the dev vault.
- **1.2 Core model**: `src/core/types.ts`, `defaults.ts`, `issueFile.ts` (parse/serialize, round-trip safe, activity feed parse/append), `projectFile.ts`, `ids.ts`. Unit tests for round-trips, comments/events parsing, unknown-key preservation, ID allocation with gaps and externally created files.

### Phase 2 — Plugin shell and data store
- **2.1 Shell**: settings model + tab (folder, prefix, display name), first-run setup modal, folder/`All Issues.base`/`.kyle-tickets.json` creation, ribbon icon, commands, placeholder `MainView` (React root mounted/unmounted correctly).
- **2.2 IssueStore**: index `Issues/` + `Projects/` on load and on vault/metadataCache events; API `create`, `update(id, patch)`, `addComment`, `delete`, `createProject`, `updateProject`; activity events on writes; external-change diffing; `useIssues()` React hook. Tests for the pure diff → events function.

### Phase 3 — Pickers and List
- **3.1 Pickers + New issue**: shared popover pickers (status, priority, labels w/ create, assignee w/ free text + recent, project, milestone, date) with type-to-filter and keyboard nav; status/priority icons as React components; **New issue** modal (title, description, status, priority, labels, project, assignee, parent) bound to the command.
- **3.2 Main view + List**: sidebar navigation (All Issues, Active, Backlog, Projects list), header with layout toggle placeholder, List view with grouping by status (and other fields via `core/query.ts`), collapsible group headers with counts, rows with chips, click opens the ticket. Tests for `query.ts` grouping.

### Phase 4 — Display and Board
- **4.1 Display popover**: sub-grouping, ordering, completed/sub-issue/empty-group toggles, property chips; persisted per sidebar view in plugin data. Tests for sub-grouping/ordering/completed filtering.
- **4.2 Board**: columns per group, swimlanes per sub-group, preview cards, dnd-kit drag between columns/swimlanes (updates grouped field via `IssueStore`) and within a column (manual `sortOrder`).

### Phase 5 — Filters, shortcuts, settings editors
- **5.1 Filter bar**: condition model in `core/query.ts`, "+ Filter" UI with removable chips, persisted per view. Tests for filter evaluation.
- **5.2 Shortcuts + editors**: scoped keyboard shortcuts in Main and Issue views; settings editors for statuses (category, color, order, rename with file rewrite, delete with reassign) and label colors.

### Phase 6 — Issue view
- **6.1 Page + properties**: `IssueView` registration, file-open interception for ticket files, Open as Markdown/issue toggle, breadcrumb, inline title editing, right properties sidebar using the pickers.
- **6.2 Description, sub-issues, activity**: rendered description + CM6 editor; sub-issues list + "Add sub-issue"; activity feed rendering; comment box (`Ctrl+Enter`).

### Phase 7 — Projects
- **7.1 Project pages**: create/rename/delete project, `ProjectView` header (icon, color, status, lead, target), editable description, project entries in the sidebar.
- **7.2 Milestones + project issues**: milestone CRUD with target dates and progress, project-scoped List/Board reusing Main view components, milestone picker scoped to the issue's project.

### Phase 8 — Pull requests
- **8.1 gh status**: `github/gh.ts` runner (execFile, timeout, error classification), PR cache, refresh on open + interval, PR rows in properties, PR chips on rows/cards, settings showing gh availability.
- **8.2 Auto-link**: repos list in settings, periodic search for `<PREFIX>-N` in PR titles/branches, attach to matching issues with an activity event.

### Phase 9 — Agent tooling
- **9.1 kt CLI**: `cli/kt.ts` over `src/core` (new/set/comment/list/show, `--json`), folder discovery, built by esbuild to `cli/kt.js`, `npm link`-able. Tests for argument parsing and command effects on a temp folder.
- **9.2 Agent docs + end-to-end**: `AGENTS.md` template written to the tickets folder, Claude Code skill in `skills/kyle-tickets/SKILL.md`, README usage, and an end-to-end check: create via CLI → appears in Obsidian with correct ID → status change in UI → comment via CLI shows in Issue view.
