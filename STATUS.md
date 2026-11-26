# STATUS

_Last updated: 2026-11-26_

Plan: [docs/PLAN.md](docs/PLAN.md) · Phases: [docs/PHASES.md](docs/PHASES.md) · ADRs: [docs/adr/](docs/adr/) · Glossary: [GLOSSARY.md](GLOSSARY.md) · Manual checks: [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md)

Linear parents: [LOCK-42](https://linear.app/divinity/issue/LOCK-42) (Phases 1–9) · [LOCK-61](https://linear.app/divinity/issue/LOCK-61) Command Center v2 (Phases 10–16) · [LOCK-75](https://linear.app/divinity/issue/LOCK-75) Brain v3 (Phases 17–19)

- **Done**
  - Phases 1–9 (LOCK-43…60) built and pushed; all 18 tickets are Done in Linear.
  - Queue sidebar: Triage/Todo tabs, parent progress, launch button, Shift for account picker.
  - Tiled terminals (up to 4 columns x 2 stacked): drag to split, expand, state outlines. Splitting doesn't duplicate Claude's screen (bundled ConPTY, [term ADR-0003](src/modules/term/docs/ADR/0003-bundled-conpty.md)), the wheel scrolls Claude, bright white is readable. Each new session gets a unique colour tag, shown on its sidebar stripe and pane header.
  - Terminals: clicks reach Claude (expand tool calls; Shift-drag, Option-drag on macOS, selects), URLs are clickable, sounds play only for Claude sessions you can't see, macOS supported (login shell/zsh/bash, [ADR-0013](docs/adr/0013-macos-terminals.md)), translucent macOS backgrounds no longer hide text. Files drop into terminals as paths; pasted screenshots are saved to a temp file and pasted as a path; copying drops box borders, shared indent and trailing spaces.
  - kyle-hook lives in the vault's `.claude/settings.local.json`: 9 events, installed from Linux Obsidian in the portable `${CLAUDE_PROJECT_DIR}` form (backup kept). Global `~/.claude/settings.json` has none, on both Windows and Linux.
  - Convention docs: locked-away keeps them in `docs/conventions/agent.md` and `human.md` (Conventions folder setting).
  - Old kyle-tickets and kyle-term plugins are disabled in both vault copies; Linux Obsidian runs kyle-hub only, with one hook server on 127.0.0.1.
  - WSL2 vaults ([ADR-0014](docs/adr/0014-wsl2-vaults.md)): hook entries use `${CLAUDE_PROJECT_DIR}` (install migrates old absolute-path entries; doctor flags them), `WSLENV` forwards the hook env, and the hook server falls back to the `vEthernet (WSL)` address for a WSL-share vault; terminals in the WSL vault open in a "WSL (Ubuntu)" profile and run the Linux `claude`. On Windows 10 Windows Obsidian can't watch the share (`EISDIR`), so locked-away runs in **Linux Obsidian through WSLg**, where none of that bridging activates. WebGL there needs `GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA /opt/Obsidian/obsidian --ozone-platform=x11 --ignore-gpu-blocklist --disable-gpu-sandbox --use-gl=angle --use-angle=gl` (verified; without it the brain falls back to a flat "3D brain unavailable" panel, and SwiftShader is too slow). Deploy ships the `node-pty-linux-x64` prebuild and targets `\\wsl.localhost\Ubuntu\home\pepzii\locked-away` first, then the old `C:\Development\locked-away` copy.
  - Configurable brain folder: brain settings "Brain folder" (default `Brain`) and "Conventions folder" (default `<brain folder>/conventions`) used by scan, inventory, health, New doc, conventions, promote and `kh lint docs`; the Docs count now honours `dir/**` exclude globs like health does. Deployed; the WSL vault's data.json has Conventions folder = `docs/conventions` (Brain folder default; backup `data.json.bak-brain-folder`).
  - Health: build passes, 1129 tests pass (1 skipped), lint 0 errors (3 warnings), `main.js` 2408 KB (minified, three.js included) (limit 3072 KB). Command Center CDP smoke passes 8/8 in the real vault.
- **In progress**: verification in the real vault, now `/home/pepzii/locked-away` in Linux Obsidian (`/opt/Obsidian`) through WSLg. Latest build (`353d70f`) is deployed and loaded there. The old Windows copy `C:\Development\locked-away` is still deployed to until retired. All 223 boxes in [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) are unticked.
- **Blocked**: ticket launch and per-repo brain checks, because the vault's repo map is empty (launch fails with "No repos in the repo map").
- **Command Center v2** (LOCK-61): all 13 tickets (LOCK-62–74) built, verified (build/test/lint/check-size) and Done; LOCK-61 closed. Deployed to the real vault. Post-review rework (done, pushed): brain no longer renders white (bloom/clear-colour fix); brain is a full-view backdrop behind translucent cards; Spend is a slim strip at the top; folder hubs connect every note and frontmatter references count as links; hover card (title, folder, snippet), click opens the note, folder picker/focus, agent name tags. Awaiting your review of the new look ("theme" assumed to mean the Hivemynd reference). v2 manual checks unticked. Small-window fixes (2026-11-26): layout collapses by view width, Docs/Scripts/Skills/Agents counts wrap to 2x2, Spend strip wraps instead of overlapping, Retro card shows running/result/error, plain backdrop when the Brain module is off.
- **Brain v3** (LOCK-75): all six tickets (LOCK-76–81) built, verified (build/test/lint/check-size) and Done; LOCK-75 closed. Deployed to the real vault. None of it has been checked by eye yet (no CDP in the running Obsidian); 17.2 screenshots deferred to the manual checks.
- **Next**
  0. Run the "Linux Obsidian in WSLg" manual checks (start with a Claude session and its status lights). Then retire the Windows copy: drop it from `.env.local`.
  1. Run the Brain v3 manual checks (brain shape, themes, orbiting agents, toasts, brain menu, Retro card), then the Command Center v2 ones (includes the 2,000-note frame-rate test; watch GPU load).
  2. Run the "Terminal tiling" manual checks.
  3. Add repos to the repo map in kyle-hub settings, then check Queue launch and clear kyle-hub's brain findings.
  4. Register the scheduled task (`kh schedule install --yes`; `kh doctor` reports it missing). It's schtasks-only, so decide whether maintenance runs from Windows against the share or needs a Linux cron path.
  5. Set `cleanupPeriodDays` in Claude settings (`kh doctor` warns; the default is 30).
  6. Finish the cutover: `kh import linear` (no imported tickets in the vault yet), then archive the kyle-term and kyle-tickets repos.
  7. Run the remaining manual checks and CDP smoke scripts; calibrate usage caps against `/usage`.
- **Known gaps**
  - Tile layout is not persisted.
  - macOS terminals are unit-tested only (not run on a Mac yet); `kh schedule` stays Windows-only.
  - Plain shells (no hook events) can show working on a focus or resize redraw after typing; they never glow, count as "need you" or play sounds.
  - `kh` CLI changes to Done are not gated on acceptance criteria.
  - Usage "official reading" is an unverified best-effort.
  - Retro patcher on CRLF files is untested.
  - Brain health is recomputed on plugin load only.
  - Gaps cutoff (`commandCenter.gapsCutoff`, default 70) has no UI control.
  - A sub-agent read arriving just after its stop event brings its moon back until the 10-minute fallback or parent end.
  - Brain layout re-runs (about 230 ms at 500 notes) on every note or link change, after the 500 ms debounce.
  - Non-brain shapes have no region labels (folder focus is in the brain menu).

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
| 17 Brain shape + look | 17.1 · 17.2 | LOCK-76 · LOCK-77 | S · S | Done (17.2 screenshots pending) |
| 18 Orbiting agents | 18.1 · 18.2 | LOCK-78 · LOCK-81 | S · S | Done |
| 19 Command Center tidy | 19.1 · 19.2 | LOCK-79 · LOCK-80 | H · H | Done |
