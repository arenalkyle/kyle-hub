# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Linear parent: [LOCK-10](https://linear.app/divinity/issue/LOCK-10) · Manual checks: [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md)

- **Done** (reviewed, pushed, Linear Done): LOCK-11 → LOCK-22. Scaffold + CI, `src/core` model (ticket/project files, feed, IDs, query/display pipeline), plugin shell + setup, IssueStore (index, write API, activity log, external-edit detection), pickers + New issue window, main view sidebar + grouped windowed List, Display popover (grouping, sub-grouping, ordering, toggles, chips; per-view state), Board (columns, swimlanes, preview cards, dnd-kit drag-and-drop, manual `sortOrder` reorder), filter bar (AND-ed chips, per-view), keyboard shortcuts + Statuses/Labels settings editors with bulkUpdate, issue page (IssueView, file-open interception, breadcrumb, inline title, properties sidebar), issue page description editor, sub-issues, activity feed and comments. 148 tests passing.
- **In review**: LOCK-23 (7.1): project pages (New project window, page in MainView and as its own view for directly opened files, rename with issue-link rewrite, delete with confirm, status/icon/color, progress, sidebar icons + Archived group). 161 tests passing; manual checks not run yet.
- **Next**: LOCK-24 → LOCK-28.
- **Manual checks**: 1.1–6.2 (LOCK-11…22) are written up in `docs/MANUAL-CHECKS.md` and have not been run in Obsidian yet.

| Phase | Sub-phases | State |
|---|---|---|
| 1 Foundation | 1.1 scaffold (LOCK-11) · 1.2 core model (LOCK-12) | Done · Done |
| 2 Shell + store | 2.1 shell (LOCK-13) · 2.2 IssueStore (LOCK-14) | Done · Done |
| 3 Pickers + List | 3.1 pickers/New issue (LOCK-15) · 3.2 main view + List (LOCK-16) | Done · Done |
| 4 Display + Board | 4.1 Display popover (LOCK-17) · 4.2 Board (LOCK-18) | Done · Done |
| 5 Filters + shortcuts | 5.1 filter bar (LOCK-19) · 5.2 shortcuts + settings editors (LOCK-20) | Done · Done |
| 6 Issue view | 6.1 page + properties (LOCK-21) · 6.2 description/sub-issues/activity (LOCK-22) | Done · Done |
| 7 Projects | 7.1 project pages (LOCK-23) · 7.2 milestones + project issues (LOCK-24) | In Review · Todo |
| 8 Pull requests | 8.1 gh status (LOCK-25) · 8.2 auto-link (LOCK-26) | Todo |
| 9 Agent tooling | 9.1 kt CLI (LOCK-27) · 9.2 agent docs + e2e (LOCK-28) | Todo |
