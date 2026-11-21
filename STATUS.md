# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Phases: [docs/PHASES.md](docs/PHASES.md) · ADRs: [docs/adr/](docs/adr/) · Glossary: [GLOSSARY.md](GLOSSARY.md)

Linear parent: [LOCK-42](https://linear.app/divinity/issue/LOCK-42)


- **Done**: design grilling; PLAN, 11 ADRs, GLOSSARY, phased breakdown, ticket stubs written; Linear tickets LOCK-42…60 created (Phase 9 accounts + usage added).
- **In progress**: Phase 1.2 (LOCK-44) built locally and in review: tickets module on core, `TicketService`, bus events, settings migration, `kh-tickets-` CSS. Not pushed. Phase 1.1 (LOCK-43) in review.
- **Also in review**: Phase 7.2 (LOCK-56) built locally: rule-based doc selection in context packs (`core/brain/selectDocs`, `core/domain/packDocs`, budget 8k tokens, "Docs included" section), `kh status draft`, brain health score + `brain:health-changed`, style-convention templates. Not pushed.
- **Also in review**: Phase 7.1 (LOCK-55) built locally: `core/brain/` (doc types, `lintDoc`, six pure staleness checks, rg-or-Node scan, `New doc` helpers), brain module (`BrainService`, New doc command, templates), `kh lint docs`, `kh brain check [--tickets]`, `brain.autoFindings` in `kh maintain`. Not pushed. Not yet run inside Obsidian (New doc modal needs a manual check).
- **Also in review**: Phase 8.1 (LOCK-57) built locally: `command-center` module (read-only custom view: tiles, needs-attention / recent runs / open proposals lists, inline SVG 30-day spend sparkline, degrades per disabled module, 60s + bus refresh), `kh-command-center-` CSS, `scripts/cdp-command-center-smoke.mjs`. Not pushed.
- **Also in review**: Phase 8.2 (LOCK-58) built locally: vault `core.profile` (work|home), launch guard (`profile-mismatch`, before git/spawn), dashboard and retro scoped to the vault profile, work profile hides Draft rule, pure `core/domain/scrub` + `promote`, Promote modal (brain module, command + `promote` service, writes only on confirm), `kh promote <file> --to <homeVault> [--dry-run]`, `smoke:promote`. Not pushed. CDP smoke not yet run against live Obsidian.
- **Next**: review + push 1.1, 1.2, 2.1, 2.2 → Phase 3.1 (LOCK-47).
- **Also in review**: Phase 2.1 (LOCK-45) built locally: term module on core (`SessionService`, `session:*` bus events, kyle-term settings migration, `kh-term-` CSS, macOS paths removed, Install/Uninstall hooks with diff modal). Not pushed. CDP smoke (`npm run smoke`) needs a manual run in Obsidian.
- **Also in review**: Phase 2.2 (LOCK-46) built locally: `kh` CLI (`cli/`, `kh tickets …`), `kt` shim, `kh import linear` (recorded-fixture tests). Not pushed. Cutover checklist and Linear import run are manual.

- **Also in review**: Phase 3.2 (LOCK-48) built locally: Triage view (`j k Enter a r d u`), type chip + Display type option, new fields in the properties sidebar, Done gate (`plugin.updateIssue`), generated `Triage/Queue/Proposals/Blocked.base`. Not pushed. `npm run smoke:triage` needs a manual run in a throwaway vault.

- **Also in review**: Phase 4.1 (LOCK-49) built locally: `LogService` in `src/core/logs/` (incremental transcript ingest, derived redacted records, hook spool merge), `kh logs ingest`. Not pushed. Not yet registered on the hub; no real-log run in the repo (manual checklist in the ticket).

- **Also in review**: Phase 5.1 (LOCK-51) built locally: Queue view in the right sidebar, `Launcher` (repo resolve, worktree per ticket, context pack via `core/domain/pack`, spawn with `KH_*` env, status + run id), repo map and launch limits in the hub settings. Not pushed. `npm run smoke:launch` needs a manual run in a throwaway vault.

- **Also in review**: Phase 5.2 (LOCK-52) built locally: `term/run/` (run registry, `finishRun` with agent-summary detection, mechanical summary, outcome and `costUsd` rollup, needs-attention tracker + stall detector, worktree cleanup offer), `attention` service and chips, `kt comment` authors as `agent:<KH_RUN>` in a run, `SessionEnd` hook, `LogService.annotateRun` and session-limited ingest. Not pushed. `npm run smoke:session-end` needs a manual run in a throwaway vault.

- **Also in review**: Phase 6.1 (LOCK-53) built locally: pure `term/retro/` (detectors, signatures, clustering, watermark state in `retro.json`, `sessionsSinceRetro`), `kh retro detect` dry run. Not pushed. No real-run check yet (manual checklist in the ticket).

- **Also in review**: Phase 6.2 (LOCK-54) built locally: retro templates (`term/retro/templates/`), `performRetro` (agent tickets, `maxTickets`, dedupe, recurrence check), Perform Retro button with watermark and nudge, Apply button (`git apply` / built-in patcher with backup), opt-in Draft rule with Haiku (off by default, daily cap), `retro` service. Not pushed. `npm run smoke:retro` needs a manual run in a throwaway vault.

- **Also in review**: Phase 9.1 (LOCK-59) built locally: `core/accounts` (registry in `core.accounts`, ticket > repo > default resolution, profile guard), launch sets `CLAUDE_CONFIG_DIR` + `KH_ACCOUNT` and run records carry `accountId`, ingest reads every account's `<configDir>/projects` and tags records, launch-flow account picker, settings UI (add/login/rename/default/remove, repo account), `kh account list|add|login|use|remove`. Not pushed. Real `/login` and a live launch need a manual run in Obsidian.

| Phase | Sub-phases | Ticket | Model | State |
|---|---|---|---|---|
| 1 Foundation | 1.1 · 1.2 | LOCK-43 · LOCK-44 | S · S | 1.1 · 1.2 in review |
| 2 Term + cutover | 2.1 · 2.2 | LOCK-45 · LOCK-46 | S · H | 2.1 · 2.2 in review |
| 3 Schema + triage | 3.1 · 3.2 | LOCK-47 · LOCK-48 | H · S | 3.1 in review · 3.2 not started |
| 4 Logs | 4.1 · 4.2 | LOCK-49 · LOCK-50 | H · H | 4.1 in review · 4.2 in review |
| 5 Bridge | 5.1 · 5.2 | LOCK-51 · LOCK-52 | S · S | 5.1 in review · 5.2 not started |
| 6 Retro | 6.1 · 6.2 | LOCK-53 · LOCK-54 | H · S | 6.1 in review · 6.2 in review |
| 7 Brain | 7.1 · 7.2 | LOCK-55 · LOCK-56 | H · H | 7.1 in review · 7.2 in review |
| 8 Command center + profiles | 8.1 · 8.2 | LOCK-57 · LOCK-58 | H · S | 8.1 in review · 8.2 in review |
| 9 Accounts + usage | 9.1 · 9.2 | LOCK-59 · LOCK-60 | S · S | 9.1 in review · 9.2 not started |
