# STATUS

_Last updated: 2026-11-22_

Plan: [docs/PLAN.md](docs/PLAN.md) · Phases: [docs/PHASES.md](docs/PHASES.md) · ADRs: [docs/adr/](docs/adr/) · Glossary: [GLOSSARY.md](GLOSSARY.md) · Manual checks: [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md)

Linear parents: [LOCK-42](https://linear.app/divinity/issue/LOCK-42) (Phases 1–9) · [LOCK-61](https://linear.app/divinity/issue/LOCK-61) Command Center v2 (Phases 10–16) · [LOCK-75](https://linear.app/divinity/issue/LOCK-75) Brain v3 (Phases 17–19)

- **Done**
  - Phases 1–9 (LOCK-43…60) built and pushed; all 18 tickets are Done in Linear.
  - Queue sidebar: Triage/Todo tabs, parent progress, launch button, Shift for account picker.
  - Tiled terminals (up to 4 columns x 2 stacked): drag to split, expand, state outlines. Splitting doesn't duplicate Claude's screen (bundled ConPTY, [term ADR-0003](src/modules/term/docs/ADR/0003-bundled-conpty.md)), the wheel scrolls Claude, bright white is readable. Each new session gets a unique colour tag, shown on its sidebar stripe and pane header.
  - kyle-hook lives in the vault's `.claude/settings.local.json` (9 events); removed from global `~/.claude/settings.json` (backup kept). `kh doctor` hooks ok.
  - Vault `Brain/conventions/agent.md` and `human.md` created from the shipped templates.
  - Old kyle-tickets and kyle-term plugins are disabled in the vault.
  - Health: build passes, 1000 tests pass (1 skipped), lint 0 errors (3 warnings), `main.js` 2365 KB (minified, three.js included) (limit 3072 KB). Command Center CDP smoke passes 8/8 in the real vault.
- **In progress**: verification in the real vault. Latest build (`af6e03e`) is deployed and running there; the terminal fixes were tested in throwaway vaults only. All 164 boxes in [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) are unticked.
- **Blocked**: ticket launch and per-repo brain checks, because the vault's repo map is empty (launch fails with "No repos in the repo map").
- **Command Center v2** (LOCK-61): all 13 tickets (LOCK-62–74) built, verified (build/test/lint/check-size) and Done; LOCK-61 closed. Deployed to the real vault. Post-review rework (done, pushed): brain no longer renders white (bloom/clear-colour fix); brain is a full-view backdrop behind translucent cards; Spend is a slim strip at the top; folder hubs connect every note and frontmatter references count as links; hover card (title, folder, snippet), click opens the note, folder picker/focus, agent name tags. Awaiting your review of the new look ("theme" assumed to mean the Hivemynd reference). v2 manual checks unticked.
- **Planned: Brain v3** (LOCK-75): six tickets LOCK-76–81 in Backlog (brain shape and regions, themes and shapes, orbiting agents, name tags and toasts, Brain tab removal and brain menu, Retro card and scrolling lists). See PHASES.md Phases 17–19.
- **Next**
  1. Review the reworked brain/Command Center live, then work through the Command Center v2 manual checks (includes the 2,000-note frame-rate test; watch GPU load).
  2. Run the "Terminal tiling" manual checks.
  3. Add repos to the repo map in kyle-hub settings, then check Queue launch and clear kyle-hub's brain findings.
  4. Register the scheduled task (`kh schedule install --yes`; `kh doctor` reports it missing).
  5. Set `cleanupPeriodDays` in Claude settings (`kh doctor` warns; the default is 30).
  6. Finish the cutover: `kh import linear` (no imported tickets in the vault yet), then archive the kyle-term and kyle-tickets repos.
  7. Run the remaining manual checks and CDP smoke scripts; calibrate usage caps against `/usage`.
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
| 10 Layout | 10.1 | LOCK-62 | H | Done |
| 11 Capture | 11.1 · 11.2 | LOCK-63 · LOCK-65 | S · H | Done |
| 12 Vitals | 12.1 | LOCK-66 | H | Done |
| 13 Brain 3D | 13.1 · 13.2 | LOCK-67 · LOCK-70 | S · S | Done |
| 14 Gaps | 14.1 · 14.2 | LOCK-68 · LOCK-71 | S · H | Done |
| 15 Gaps UI | 15.1 · 15.2 | LOCK-72 · LOCK-73 | H · H | Done |
| 16 Templates | 16.1 · 16.2 · 16.3 | LOCK-64 · LOCK-69 · LOCK-74 | H · S · S | Done |
| 17 Brain shape + look | 17.1 · 17.2 | LOCK-76 · LOCK-77 | S · S | Backlog |
| 18 Orbiting agents | 18.1 · 18.2 | LOCK-78 · LOCK-81 | S · S | Backlog |
| 19 Command Center tidy | 19.1 · 19.2 | LOCK-79 · LOCK-80 | H · H | Backlog · 19.2 Done |
