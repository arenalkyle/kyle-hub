# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Linear parent: [LOCK-10](https://linear.app/divinity/issue/LOCK-10) · Manual checks: [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md)

- **Done** (reviewed, pushed, Linear Done): LOCK-11 → LOCK-28 (all sub-tickets of LOCK-10). Scaffold + CI, `src/core` model (ticket/project files, feed, IDs, query/display pipeline), plugin shell + setup, IssueStore (index, write API, activity log, external-edit detection), pickers + New issue window, main view sidebar + grouped windowed List, Display popover (grouping, sub-grouping, ordering, toggles, chips; per-view state), Board (columns, swimlanes, preview cards, dnd-kit drag-and-drop, manual `sortOrder` reorder), filter bar (AND-ed chips, per-view), keyboard shortcuts + Statuses/Labels settings editors with bulkUpdate, issue page (IssueView, file-open interception, breadcrumb, inline title, properties sidebar), issue page description editor, sub-issues, activity feed and comments, project pages (create, edit, rename, delete; ProjectView + interception), milestones + project-scoped List/Board via shared IssueCollection, live PR status via gh CLI (cache, background refresh, chips), PR auto-link by issue ID for watched repos, kt CLI for agents over src/core (npm link), agent docs (generated AGENTS.md, Claude Code skill, README, PLAN updated). 220 tests passing.
- **In progress**: none. CI green on `main`; plugin deployed to the vault; `kt` linked globally.
- **Next**: run `docs/MANUAL-CHECKS.md` in Obsidian (1.1–9.2 + end-to-end UI steps); fill README screenshots.
- **Manual checks**: 1.1–9.2 (LOCK-11…28) and the end-to-end script are written up in `docs/MANUAL-CHECKS.md` and have not been run in Obsidian yet.

| Phase | Sub-phases | State |
|---|---|---|
| 1 Foundation | 1.1 scaffold (LOCK-11) · 1.2 core model (LOCK-12) | Done · Done |
| 2 Shell + store | 2.1 shell (LOCK-13) · 2.2 IssueStore (LOCK-14) | Done · Done |
| 3 Pickers + List | 3.1 pickers/New issue (LOCK-15) · 3.2 main view + List (LOCK-16) | Done · Done |
| 4 Display + Board | 4.1 Display popover (LOCK-17) · 4.2 Board (LOCK-18) | Done · Done |
| 5 Filters + shortcuts | 5.1 filter bar (LOCK-19) · 5.2 shortcuts + settings editors (LOCK-20) | Done · Done |
| 6 Issue view | 6.1 page + properties (LOCK-21) · 6.2 description/sub-issues/activity (LOCK-22) | Done · Done |
| 7 Projects | 7.1 project pages (LOCK-23) · 7.2 milestones + project issues (LOCK-24) | Done · Done |
| 8 Pull requests | 8.1 gh status (LOCK-25) · 8.2 auto-link (LOCK-26) | Done · Done |
| 9 Agent tooling | 9.1 kt CLI (LOCK-27) · 9.2 agent docs + e2e (LOCK-28) | Done · Done |

## Known limitations

- Windows 10, desktop only; github.com PRs only; `gh` must be installed and authenticated.
- Board J/K walks cards column by column (no H/L); the default status cannot be deleted until another is default; label names cannot contain spaces.
- Forced-Markdown tabs and the issue sidebar's collapsed state do not survive a restart.
- Long activity feeds show the newest 50 entries with "Show earlier" (no virtualization); `main.js` is about 2.2 MB because `@codemirror/lang-markdown` is bundled.
- External edits made without `updatedBy` are logged as `@external`; `kt` writes log their own events once.
- All manual (in-Obsidian) checks in `docs/MANUAL-CHECKS.md` are still unrun.
