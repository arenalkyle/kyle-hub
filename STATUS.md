# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Linear parent: [LOCK-10](https://linear.app/divinity/issue/LOCK-10)

- **Done**: design + PLAN + ADRs + GLOSSARY; Linear LOCK-10…LOCK-28; Phase 1 (LOCK-11 scaffold, LOCK-12 core model); Phase 2.1 shell (LOCK-13); Phase 2.2 IssueStore (LOCK-14): live vault index, write API (create/update/comment/delete issue, create/update project), `diffToEvents`, debounced external-edit events, `useIssues/useProjects/useIssue` hooks, main view shows "N issues". Phase 3.1 pickers (LOCK-15): generic `Picker<T>`, 8 concrete pickers, Status/Priority icons, New issue modal + command (`openNewIssue(defaults)`). 46 tests.
- **In progress**: — (LOCK-15 in review)
- **Next**: Phase 3.2 Main view + List. LOCK-11…15 await review; LOCK-13/14/15 need manual check in Obsidian.

| Phase | Sub-phases | State |
|---|---|---|
| 1 Foundation | 1.1 scaffold (LOCK-11) · 1.2 core model (LOCK-12) | 1.1 in review · 1.2 in review |
| 2 Shell + store | 2.1 shell (LOCK-13) · 2.2 IssueStore | 2.1 in review · 2.2 in review |
| 3 Pickers + List | 3.1 pickers/New issue (LOCK-15) · 3.2 Main view + List | 3.1 in review · 3.2 Todo |
| 4 Display + Board | 4.1 Display popover · 4.2 Board | Todo |
| 5 Filters + shortcuts | 5.1 filter bar · 5.2 shortcuts + settings editors | Todo |
| 6 Issue view | 6.1 page + properties · 6.2 description/sub-issues/activity | Todo |
| 7 Projects | 7.1 project pages · 7.2 milestones + project issues | Todo |
| 8 Pull requests | 8.1 gh status · 8.2 auto-link | Todo |
| 9 Agent tooling | 9.1 kt CLI · 9.2 agent docs + e2e | Todo |
