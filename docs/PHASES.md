# kyle-hub — phases

One sub-agent per sub-phase; each sub-phase is about half a context. Gate for every sub-phase: `npm run build && npm test && npm run lint` green on Windows, STATUS.md updated. Model: **S** = Sonnet (`model: "sonnet"`), **H** = Haiku. A switch mid-flight follows the HANDOFF.md rule.

**Precondition:** LOCK-29…41 manual checks closed in the old repos; both old repos frozen.

## Phase 1 — Foundation

**1.1 Repo + core skeleton (S)**
- New repo, `git subtree add` kyle-tickets → `src/modules/tickets`, kyle-term → `src/modules/term`.
- esbuild, tsconfig, vitest, ESLint with `no-restricted-imports` module rule, CI on `windows-latest`, bundle size budget.
- `core`: service registry, typed event bus, settings registry (namespaces + `schemaVersion`), `redact()` stub, path resolver; `core/domain` moved from tickets `src/core`.
- AC: build passes; lint fails a deliberate cross-module import; registry/bus/settings unit tests.

**1.2 Tickets module on core (S)**
- Tickets module registers `TicketService`; IssueStore unchanged in behaviour; CSS `kt-` → `kh-tickets-`.
- Settings migration from `.obsidian/plugins/kyle-tickets/data.json` with `.bak`.
- AC: all existing kyle-tickets tests pass; golden migration test; ticket files byte-identical after load/save.

## Phase 2 — Term + cutover

**2.1 Term module on core (S)**
- Term module registers `SessionService`; macOS paths removed; CSS `kterm-` → `kh-term-`; settings migration from kyle-term `data.json`.
- Hook installer swaps entries in `~/.claude/settings.json` (diff preview, idempotent); hook script still never blocks.
- AC: existing kyle-term tests pass (minus macOS); installer tests (install/upgrade/uninstall on fixture settings); CDP smoke opens a terminal.

**2.2 `kh` CLI, cutover, Linear import (H)**
- `kh` binary over `core/domain`; `kt` shim → `kh tickets`; regenerate AGENTS.md/skill.
- `kh import linear --project <key>` (GraphQL; idempotent; `linearId`, parents, comments, status map).
- Cutover checklist in `docs/MANUAL-CHECKS.md`.
- AC: `kt` e2e tests pass through the shim; import tested against a recorded API fixture; re-import is a no-op.

## Phase 3 — Schema + triage

**3.1 Fields, gates, flood controls (H)**
- New frontmatter fields + acceptance-criteria parser (pure, round-trip safe).
- `--agent` gates (Triage only; no `agent-ready`; no completed status); fingerprint dedupe; caps; expiry sweep (`kh tickets expire`).
- AC: unit tests for each gate, dedupe, caps and expiry; old tickets round-trip unchanged.

**3.2 Triage UI (S)**
- Triage view with `a`/`r`/`d`/`j`/`k`; type chip; new fields in properties sidebar; Done gate with logged override; `.base` files for Triage/Queue/Proposals/Blocked.
- AC: CDP smoke for the triage keys; Done blocked with unchecked criteria.

## Phase 4 — Logs

**4.1 LogService + ingest (H)**
- `%LOCALAPPDATA%\kyle-hub\<profile>\`; incremental transcript ingest (byte offsets in `state.json`); derived-record schema; hook events merged by `KH_RUN`; redaction rules + denylist; cost from price table.
- AC: synthetic transcript fixtures → expected derived records; redaction corpus passes; re-ingest is idempotent.

**4.2 Index, retention, scheduling (H)**
- `index.jsonl` queries (by ticket, repo, since); retention sweep; `kh schedule install` (Windows Task Scheduler) running ingest + sweep + expiry; `cleanupPeriodDays` check in setup.
- AC: query + sweep unit tests; scheduler command tested via dry-run output.

## Phase 5 — Bridge

**5.1 Queue + launch (S)**
- Queue sidebar in term; launch flow: repo resolve, worktree create/reuse, ticket-only context pack, spawn with env + `--model`, status change, run id, event; concurrency cap.
- AC: launch flow unit tests with fake git/pty; CDP smoke: launch a fixture ticket in a temp repo.

**5.2 Session end + attention (S)**
- Agent-summary detection; mechanical fallback summary; In Review / needs-attention transition; outcome + `costUsd` rollup; needs-attention badges and chips; worktree cleanup offer.
- AC: event-stream fixtures → expected status/comment; badge appears on a permission-prompt fixture.

## Phase 6 — Retro

**6.1 Detectors (H)**
- Pure `term/retro/`: signals, signature normalization, clustering threshold, watermark in `state.json`, "N sessions since" count.
- AC: fixture runs → expected clusters; runs before the watermark are ignored.

**6.2 Proposals + apply (S)**
- Templates per signal type → proposal/finding tickets (via `TicketService`, `source: agent:retro`, fingerprint = signature); per-retro cap; Apply (`git apply --check` / backup); recurrence comment; retro button + watermark UI; opt-in "draft rule" button (Haiku, $ cap).
- AC: template golden diffs; apply round-trip on a temp repo; recurrence detected across two fixture retros; zero LLM calls with default settings.

## Phase 7 — Brain

**7.1 Doc types + staleness (H)**
- Templates, frontmatter, `kh lint docs`; staleness checks; findings (capped, deduped).
- AC: lint fixtures; each staleness check has a positive and a negative fixture.

**7.2 Retrieval + health (H)**
- Rule-based doc selection into context packs (budget, priority); per-repo include list; `kh status draft`; health score + `brain:health-changed`.
- AC: pack golden files per rule; budget truncation test.

## Phase 8 — Command center + profiles

**8.1 Dashboard (H)**
- Custom view: tiles (triage, queue, running, needs-attention, spend, brain health, retro nudge), lists, SVG sparkline; read-only via services; degrades gracefully when modules are off.
- AC: renders with each module disabled; CDP smoke.

**8.2 Profiles + promote (S)**
- Repo-map `profile`; vault profile; launch guard; per-profile log trees; work-profile no-excerpt rule; Promote scrubber + diff modal → home vault `Brain/lessons/`.
- AC: guard refuses mismatched launch; scrubber corpus; work retro output has no excerpts.

## Order rationale
Foundation and cutover first (no behaviour loss), then schema, then logs (runs need ids and an index), then the bridge (the loop is usable after Phase 5), then retro (needs data), then brain and the dashboard.
Accounts + usage (Phase 9) come last: they need the ingest index (4), the launch flow (5.1) and the dashboard (8.1).

## Phase 9 — Accounts + usage

**9.1 Accounts + launch routing (S)**
- Account registry in core settings: `{id, label, kind: subscription|enterprise, plan, configDir, profile?}`. Isolation = one `CLAUDE_CONFIG_DIR` per account (own login, own transcripts). kh never reads or stores tokens.
- Add account (creates configDir, opens a term tab running `claude` with that env for `/login`), login/re-login, remove, set default, rename. Repo-map `account` default; per-ticket override; launch picker.
- Launch (5.1) sets `CLAUDE_CONFIG_DIR` from the chosen account; run records carry `accountId`; ingest (4.x) reads every account's `<configDir>/projects`. Launch guard (8.2) also refuses an account whose `profile` mismatches.
- CLI: `kh account list|add|login|use|remove`.
- AC: launch env contains the right `CLAUDE_CONFIG_DIR` (fake pty); ingest tags records per account; profile-mismatch refusal; no credential files read (test greps access list).

**9.2 Usage tracker + surfaces (S)**
- Pure `core/domain/usage`: from derived records compute per account (a) **session window** — rolling 5 h block starting at the first message after the previous block ended, with reset time; (b) **week** — rolling 7 d; tokens, messages, estimated cost. Subscription: percent = used ÷ user-calibrated cap per window (`usage.caps.<plan>`; defaults are placeholders, user calibrates against `/usage`). Enterprise: usage-billed, so show $ today / month vs optional budget instead of percent.
- Opt-in `usage.officialReading` (default off): read the account's own reading from the CLI/endpoint for exact percent; clearly labeled undocumented/best-effort; failure falls back to the estimate. Estimates are labeled "estimate" (other machines/apps are not seen).
- Surfaces: dashboard tile (8.1) with two bars (session, week) per account + reset countdown; Obsidian status-bar chip for the default account; usage line in the launch picker; warning at 80 % (setting) — never auto-switches accounts.
- Usage events (`usage:threshold`) comment on running tickets once per window.
- CLI: `kh usage [--account id] [--json]`.
- AC: window/week boundary fixtures (block rollover, week roll-off, DST); enterprise renders $ not %; officialReading off ⇒ zero network/file access beyond transcripts; dashboard renders with module off; CDP smoke.

## Phase 10–16 — Command Center v2 (parent LOCK-61)

Brain view, vitals and gaps. Almost all deterministic: scripts compute every number; a model only runs when a Retro proposal is accepted. Hivemynd (installed in the vault) is visual reference only until Phases 17–19, which allow copying its palettes, shape formulas and orbit maths as data or small functions, with credit in `NOTICE`. Still no dependency on its bridge. Tickets carry full acceptance criteria; this is the summary.

**10.1 Layout (H, LOCK-62)**: outer columns at half width, Spend shrinks to a strip, Usage tile removed, Retro moves to the left column, header tabs `Command Center | Tickets | Terminal | Brain` (Brain view placeholder).

**11.1 Vault-scoped capture (S, LOCK-63)**: kyle-hook installed in `<vault>/.claude/settings.local.json` and removed from global settings (status lights then work for vault sessions only). Spool keeps vault-relative path, search pattern/root and hit count; never contents. Live `brain:access` bus event. Sub-agents linked to their parent session.

**11.2 History capture (H, LOCK-65)**: transcript `search` records (Grep/Glob pattern, root, hits, duration; unknown hits for old sessions). Obsidian `file-open` recorded as `human_open`.

**12.1 Brain Vitals (H, LOCK-66)**: right-column card merged with the health score. Notes read per min / per hour (switchable), agent and human lines, writes, searches, active agents. One FPS setting (10/20/30/60, default 30) shared with the brain; pauses when hidden.

**13.1 3D brain (S, LOCK-67)**: three.js. Notes = nodes, links = edges. User zoom/rotate/pan, no auto-rotate. Glow, nebula, heat. Shared by the Command Center and the Brain tab. Must fit `check-size` (only ~280 KB headroom at 2026-11-22; ask before raising the limit).

**13.2 Agents on the brain (S, LOCK-70)**: one point per vault Claude session, named and coloured from its terminal pane (hash fallback). Sub-agents a lighter shade, `parent › agent-type`, tethered. Fly-to-note trails; fade after 2 min idle. Claude only.

**14.1 Grading + `kh gaps` (S, LOCK-68)**: pure grading in `core/domain`, 0–100 with A ≥ 90 / B 80 / C 70 / D 60 / F. Inputs: age, re-reads, undone edits, oversized-and-unkept (> 500 words, 30 days), nearby empty searches. Weights in `<vault>/.kyle-hub/grading.json` (committed). Also: empty searches by agent time, missing notes, search-time share, folders to split. Output `<vault>/.kyle-hub/gaps/latest.json` (git-ignored); run by `kh maintain`.

**14.2 Retro gap detectors (H, LOCK-71)**: worst gaps become Retro proposals (split note, write note for empty search, review note, split folder). Retro card shows waiting count.

**15.1 Gaps on the Brain tab (H, LOCK-72)**: worst-first list, cutoff 70 with slider, reasons, click opens note and highlights it on the brain.

**15.2 Terminal sidebar Gaps tab (H, LOCK-73)**: Queue panel renamed; Gaps tab beside Triage and Todo.

**16.1 Editable templates (H, LOCK-64)**: `<vault>/.kyle-hub/templates/` (committed) overrides shipped defaults; Templates settings tab with editor and Reset; shared loader for plugin and `kh`. Agents may edit the files.

**16.2 Default templates (S, LOCK-69)**: Linear ticket out, Linear ticket in, repo note, daily reminder, skill proposal, script proposal. Short, specific notes with `reviewed` frontmatter.

Order: 10 → 11 → (12, 13, 14) → 15; 16 is independent.

## Phase 17–19 — Brain v3 (parent LOCK-75)

Brain that looks like a brain, Hivemynd themes and shapes, agents that always orbit with permanent name tags, and a tidier Command Center. Hivemynd (Apache 2.0) theme palettes, shape formulas and orbit maths may be copied as data or small functions, with credit in the root `NOTICE`. This replaces the "visual reference only" rule above. Tickets carry full acceptance criteria; this is the summary.

**17.1 Brain shape and regions (S, LOCK-76)**: in `core/domain`: an anatomical Brain shape (hemispheres, gap down the middle, lobes, cerebellum, brainstem, folds) plus the Hivemynd shape library (Default, Sphere, Cube, Diamond, Pyramid, Star, Heart, Ring, Helix, Galaxy; no Cerebrum). Top-level folders map to regions (by size, "other" beyond about 8, root near the brainstem, saved so nothing jumps). Force layout held inside each region or shape.

**17.2 Scene shapes, themes, rotation (S, LOCK-77)**: shape switching with a 1 s morph; 10 themes on the brain only (cards keep Obsidian vars); heat runs from the theme's node colour to its accent; region labels replace folder hubs, tree edges hidden; auto-rotate from 0 to 1 (default 0.3), pauses on input and resumes after 5 s.

**18.1 Orbiting agents (S, LOCK-78)**: agents orbit outside the brain from session start to end (drift, still, solar, atom); no flights or trails; a lightning zap to the note on read/write (writes brighter); sub-agents as moons; a colour per session; orbit lines for solar and atom (default, rainbow or custom colour, plus opacity).

**18.2 Name tags and toasts (S, LOCK-81)**: tags always on (pane title, short ID when titles clash; folder plus ID for sessions with no pane; sub-agents smaller). Bottom-right toasts in the Command Center only: one per agent, merged within 2 s, 3 s life, 5 visible plus a 6th faded, 1–2 lines, hover pauses, click opens, can be turned off.

**19.1 No Brain tab; brain menu (H, LOCK-79)**: remove the Brain view, nav item and command; swap saved Brain tabs for the Command Center. A brain icon in the Brain Vitals title row opens folder focus, theme, shape, orbit mode, colour and opacity, rotation, toasts, and the per-min/per-hour switch. The settings tab offers the same options.

**19.2 Retro card and scrolling lists (H, LOCK-80)**: Perform Retro moves from the terminal sidebar to the Retro card; a scrollable box shows last-retro results, then doc gaps (the Gaps side panel and the terminal sidebar Gaps tab are removed). Every Command Center list is a capped-height card that scrolls inside itself. Docs updated.

Order: 17.1 → 17.2 → 18.1 → 18.2. 19.2 can run beside 17.1. 19.1 touches `scene.ts` (folder select), so it runs after 17.2 or in its own worktree with a rebase.

## WSL2 vaults (no ticket, [ADR-0014](adr/0014-wsl2-vaults.md))

Vault in WSL2, opened from Windows Obsidian via `\\wsl$`, Claude running in WSL. Hook entries use `${CLAUDE_PROJECT_DIR}` instead of absolute paths, and install migrates any old `kyle-hook.js` entry to that form. Doctor flags absolute-path entries. `WSLENV` forwards the hook env into WSL shells. For a WSL-share vault, the hook server also listens on the `vEthernet (WSL)` address, and `kyle-hook.js` falls back to it inside WSL. Terminals in a WSL-share vault open in a "WSL (<distro>)" profile (`wsl.exe -d <distro> --cd <linux path>`), and Claude types the Linux `claude` / `claude --resume`. Restored sessions move to WSL, and Windows cwds fall back to the vault root. The deploy target is the UNC vault path, then the old Windows copy. State: built, unit-tested and deployed; manual checks pending (section "WSL2 vault").

## Configurable brain folder (no ticket)

Brain settings "Brain folder" (default `Brain`) and "Conventions folder" (default `<brain folder>/conventions`) replace the hard-coded `Brain/` in scan, inventory, health, New doc, conventions, promote (the home vault's own setting, or `kh promote --brain-folder`) and `kh lint docs --vault`. They are separate because every note under the brain folder is linted: pointing it at a general `docs/` folder would count ADRs and other notes as brain docs. Stale layout-cache entries for notes that no longer exist are dropped on the next layout save. State: built and unit-tested, not deployed.
