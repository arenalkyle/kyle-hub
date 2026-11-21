# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Linear parent: [LOCK-10](https://linear.app/divinity/issue/LOCK-10)

- **Done**: design + PLAN + ADRs + GLOSSARY; Linear LOCK-10…LOCK-28; Phase 1 (LOCK-11 scaffold, LOCK-12 core model); Phase 2.1 shell (LOCK-13); Phase 2.2 IssueStore (LOCK-14); Phase 3.1 pickers + New issue modal (LOCK-15); Phase 3.2 main view (LOCK-16): resizable/collapsible sidebar (All Issues, Active, Backlog, projects), status-grouped windowed List with collapsible groups, rows with chips, inline status/priority pickers, `core/query.ts` (`selectView`, `groupIssues`). Sidebar/collapse state persisted in plugin data (`main`). 57 tests. Phase 4.1 Display popover (LOCK-17): per-view grouping, sub-grouping, ordering, completed/sub-issue/empty-group toggles, property chips; `core/display.ts`, `buildView` pipeline; saved under `views[viewId].display`. 82 tests.
- **In progress**: — (LOCK-17 in review)
- **Next**: Phase 4.2 Board. LOCK-11…17 await review; LOCK-13…17 need manual check in Obsidian.

| Phase | Sub-phases | State |
|---|---|---|
| 1 Foundation | 1.1 scaffold (LOCK-11) · 1.2 core model (LOCK-12) | 1.1 in review · 1.2 in review |
| 2 Shell + store | 2.1 shell (LOCK-13) · 2.2 IssueStore | 2.1 in review · 2.2 in review |
| 3 Pickers + List | 3.1 pickers/New issue (LOCK-15) · 3.2 Main view + List (LOCK-16) | 3.1 in review · 3.2 in review |
| 4 Display + Board | 4.1 Display popover (LOCK-17) · 4.2 Board | 4.1 in review · 4.2 Todo |
| 5 Filters + shortcuts | 5.1 filter bar · 5.2 shortcuts + settings editors | Todo |
| 6 Issue view | 6.1 page + properties · 6.2 description/sub-issues/activity | Todo |
| 7 Projects | 7.1 project pages · 7.2 milestones + project issues | Todo |
| 8 Pull requests | 8.1 gh status · 8.2 auto-link | Todo |
| 9 Agent tooling | 9.1 kt CLI · 9.2 agent docs + e2e | Todo |
