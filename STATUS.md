# STATUS

_Last updated: 2026-11-22_

Plan: [docs/PLAN.md](docs/PLAN.md) · Phases: [docs/PHASES.md](docs/PHASES.md) · ADRs: [docs/adr/](docs/adr/) · Glossary: [GLOSSARY.md](GLOSSARY.md) · Manual checks: [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md)

Linear parents: [LOCK-42](https://linear.app/divinity/issue/LOCK-42) (Phases 1–9) · [LOCK-61](https://linear.app/divinity/issue/LOCK-61) Command Center v2 (Phases 10–16)

- **Done**
  - Phases 1–9 (LOCK-43…60) built and pushed; all 18 tickets are Done in Linear.
  - Queue sidebar: Triage/Todo tabs, parent progress, launch button, Shift for account picker.
  - Tiled terminals (up to 4 columns x 2 stacked): drag to split, expand, state outlines. Splitting doesn't duplicate Claude's screen (bundled ConPTY, [term ADR-0003](src/modules/term/docs/ADR/0003-bundled-conpty.md)), the wheel scrolls Claude, bright white is readable. Each new session gets a unique colour tag, shown on its sidebar stripe and pane header.
  - kyle-hub's Claude hooks are installed (9 events, incl. SessionEnd).
  - Old kyle-tickets and kyle-term plugins are disabled in the vault.
  - Health: build passes, 830 tests pass (1 skipped), lint 0 errors (3 warnings), `main.js` 2792 KB (limit 3072 KB).
- **In progress**: verification in the real vault. The latest build is deployed but not yet confirmed there (Obsidian was closed at the last check); the terminal fixes were tested in throwaway vaults only. All 109 boxes in [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) are unticked.
- **Blocked**: ticket launch and per-repo brain checks, because the vault's repo map is empty (launch fails with "No repos in the repo map").
- **Planned**: Command Center v2 (LOCK-61): layout, vault-scoped capture, vitals, 3D brain, gaps grading, editable templates. 12 tickets in Backlog; start with 10.1 (LOCK-62). Spec in [docs/PHASES.md](docs/PHASES.md) Phases 10–16.
- **Next**
  1. Open Obsidian and run the "Terminal tiling" manual checks.
  2. Add repos to the repo map in kyle-hub settings, then check Queue launch and clear kyle-hub's brain findings.
  3. Register the scheduled task (`kh schedule install --yes`; `kh doctor` reports it missing).
  4. Set `cleanupPeriodDays` in Claude settings (`kh doctor` warns; the default is 30).
  5. Finish the cutover: `kh import linear` (no imported tickets in the vault yet), then archive the kyle-term and kyle-tickets repos.
  6. Run the remaining manual checks and CDP smoke scripts; calibrate usage caps against `/usage`.
- **Known gaps**
  - Tile layout is not persisted.
  - Sessions with no hook events (plain shells, other CLIs) can show working/finished on a focus or resize redraw after typing.
  - `kh` CLI changes to Done are not gated on acceptance criteria.
  - Usage "official reading" is an unverified best-effort.
  - Retro patcher on CRLF files is untested.
  - Brain health is recomputed on plugin load only.

| Phase | Sub-phases | Ticket | Model | State |
|---|---|---|---|---|
| 1 Foundation | 1.1 · 1.2 | LOCK-43 · LOCK-44 | S · S | Done |
| 2 Term + cutover | 2.1 · 2.2 | LOCK-45 · LOCK-46 | S · H | Done (cutover manual) |
| 3 Schema + triage | 3.1 · 3.2 | LOCK-47 · LOCK-48 | H · S | Done |
| 4 Logs | 4.1 · 4.2 | LOCK-49 · LOCK-50 | H · H | Done |
| 5 Bridge | 5.1 · 5.2 | LOCK-51 · LOCK-52 | S · S | Done |
| 6 Retro | 6.1 · 6.2 | LOCK-53 · LOCK-54 | H · S | Done |
| 7 Brain | 7.1 · 7.2 | LOCK-55 · LOCK-56 | H · H | Done |
| 8 Command center + profiles | 8.1 · 8.2 | LOCK-57 · LOCK-58 | H · S | Done |
| 9 Accounts + usage | 9.1 · 9.2 | LOCK-59 · LOCK-60 | S · S | Done |
| 10 Layout | 10.1 | LOCK-62 | H | Backlog |
| 11 Capture | 11.1 · 11.2 | LOCK-63 · LOCK-65 | S · H | Backlog |
| 12 Vitals | 12.1 | LOCK-66 | H | Backlog |
| 13 Brain 3D | 13.1 · 13.2 | LOCK-67 · LOCK-70 | S · S | Backlog |
| 14 Gaps | 14.1 · 14.2 | LOCK-68 · LOCK-71 | S · H | Backlog |
| 15 Gaps UI | 15.1 · 15.2 | LOCK-72 · LOCK-73 | H · H | Backlog |
| 16 Templates | 16.1 · 16.2 | LOCK-64 · LOCK-69 | H · S | Backlog |
