# kyle-hub — plan

Obsidian as the hub for agentic coding. Closed loop: **agents create triage tickets → human accepts and marks agent-ready → runs are launched from the queue in terminal sessions → retro finds recurring patterns → proposals return as triage tickets.**

Guiding rule: **deterministic first** ([ADR-0001](adr/0001-deterministic-first.md)). Scripts do ~99% of the work; AI runs only inside work sessions and in two opt-in buttons. Vocabulary: [GLOSSARY.md](../GLOSSARY.md). Phases: [PHASES.md](PHASES.md). Ticket stubs: [TICKETS.md](TICKETS.md).

## Architecture

```
            ┌──────────────── Obsidian (UI) ────────────────┐
            │ tickets   term(+retro UI)   brain   command-  │
            │    │          │               │     center(ro)│
            │    └──────────┴──── core ─────┴────────┘      │
            │   services · event bus · settings · redaction │
            └──────────────────────┬────────────────────────┘
                                   │ shares core/domain (no obsidian imports)
   hooks (kyle-hook.js) ──► kh CLI (backend) ◄── Windows scheduled task
                                   │
         ~/.claude/projects/*.jsonl ──ingest──► %LOCALAPPDATA%\kyle-hub\<profile>\
                                                  runs/*.jsonl · index.jsonl · packs/ · state.json
```

- **Plugin = UI**, **`kh` CLI = backend** ([ADR-0003](adr/0003-kh-cli-is-the-backend.md)). `kt` remains a shim.
- One plugin, module boundaries enforced by lint ([ADR-0002](adr/0002-single-plugin-modules-via-core-services.md)).

## Module map

| Module | Owns | Publishes | Consumes |
|---|---|---|---|
| **core** (always on) | `core/domain` (pure ticket/project model, from kyle-tickets `src/core`), service registry, typed event bus, settings registry (one `data.json`, namespace per module, `schemaVersion`), `redact()`, path resolver, `LogService` (ingest, run index, retention), CSS prefix `kh-<module>-` | `LogService` | — |
| **tickets** | IssueStore, views, Triage view, `.base` slices, gh PR integration, dedupe/caps/expiry | `TicketService` | core |
| **term** | pty helper, xterm views, hook server, sessions, queue sidebar, launch flow, worktrees, needs-attention, retro (UI + pure `term/retro/`) | `SessionService` | Ticket, Brain, Log services |
| **brain** | doc types/templates, `kh lint docs`, staleness, rule-based retrieval, `kh status draft`, health score, promote scrubber | `BrainService` | Ticket, Log |
| **command-center** | one dashboard view (tiles, lists, SVG spend sparkline) | — | all, read-only |

Events: `ticket:created|status-changed|label-changed`, `session:started|ended|needs-attention`, `run:ingested`, `retro:completed`, `brain:health-changed`. Lazy = a module's `onload` runs only if enabled; heavy views build on first open (single CJS bundle, budget ~3 MB in CI).

## Decisions (with rationale)

### Tickets
- **Fields** (all optional, round-trip safe): `type` (task|bug|plan|proposal|question|finding, default task), `repo` (key in settings repo map, inherited from the project's `repo`, then picker), `blockedBy[]`, `model` (haiku|sonnet|opus), `runs[]`, `outcome` (success|partial|failed|abandoned), `costUsd` (rollup), `source` (`human` | `agent:<session>` | `agent:retro`), `fingerprint`, `linearId`. **Acceptance criteria** = body section `## Acceptance criteria` checklist. Body is readable and agents can tick it off.
- **Lifecycle**: agent creates → Triage → human Accept (Backlog/Todo) or Decline (Canceled + reason) → human adds `agent-ready` → queue = agent-ready ∧ unstarted ∧ all blockers done → Launch → In Progress → session end → In Review (or stays In Progress, needs-attention, if no agent summary) → **Done is human-only**, gated on checked acceptance criteria (override logged). Enforced in code ([ADR-0005](adr/0005-human-gate-enforced-in-code.md)).
- **Flood controls** (configurable): fingerprint dedupe ("+1 seen again" comment), ≤5 new triage per run, ≤25 open triage total, auto-cancel untouched triage after 14 days (`expired` event), Triage view with `a`/`r`/`d`/`j`/`k`.

### Ticket ↔ terminal bridge
- **Launch** (all code): resolve repo → worktree ([ADR-0011](adr/0011-worktree-per-ticket.md)) → write context pack → spawn `claude --model <model>` with env `KH_TICKET`, `KH_RUN`; initial prompt `Work ticket <ID>. Context: @<packpath>` → status In Progress, append run id, `launched` event.
- **Context pack**, ≤~8k tokens, in priority order: ticket + acceptance criteria; parent plan summary; blockers' outcomes; brain-selected docs ([ADR-0007](adr/0007-rule-based-retrieval.md)); previous run summary; fixed footer instructing `kt comment` + ticking the criteria. If brain is off: ticket + footer.
- **Session end**: the agent writes the summary (per the footer). Fallback on `Stop`/`SessionEnd` with no agent comment: mechanical summary (duration, cost, `git diff --stat`, commits).
- **Parallel**: cap 3 concurrent runs. **Needs-attention** from existing hook signals (permission `Notification`; idle mid-turn) → queue badge + ticket chip + bus event. No pty scraping.

### Logs ([ADR-0004](adr/0004-logs-outside-vault-derived-records.md))
`%LOCALAPPDATA%\kyle-hub\<profile>\`. Incremental ingest of transcripts into redacted derived records + run index. No raw copies, no SQLite. Retention: derived 365 days, packs 30 days, daily sweep. Cost is computed from token counts × a price table in settings. Setup checks `cleanupPeriodDays`.

### Retro ([ADR-0006](adr/0006-template-first-retro-proposals.md))
Button + watermark + "N sessions since last retro" in term. Reads runs after the watermark. Detectors (pure): repeated failing commands/errors, permission denials, recurring 3–5 command sequences, interrupts/corrections after a tool call, docs read at session start, cost/duration outliers. Threshold ≥3 occurrences across ≥2 sessions. Template → proposal diff or finding; prefer script > skill > rule; size budget per template; ≤ N proposals per retro. Apply = `git apply --check` then `git apply` (backup if the target isn't in git). Next retro comments "resolved" or "recurred N×" (reopens as finding). Zero tokens by default.

### Brain
Repo docs stay in the repo (PLAN, STATUS, ADRs, GLOSSARY, CLAUDE.md); the vault brain folder (setting "Brain folder", default `Brain/`) holds cross-project docs (lessons, retro history, overviews); conventions live in the "Conventions folder" (default `<brain folder>/conventions`); brain indexes repo docs read-only. Doc types: adr, glossary, plan, status, runbook, lesson, overview, each with frontmatter `doctype`, `audience`, `reviewed`. `kh lint docs` validates them. Staleness (scripted): review date past threshold, STATUS older than the last commit by >7 days, dead path/symbol references, ADRs whose linked files were removed, unused glossary terms → health score + capped findings. Style conventions: one file per audience, referenced from CLAUDE.md, never injected.

### Command center
`.base` files for ticket slices (Triage, Queue, Proposals, Blocked). One custom view for data Bases can't reach (runs, spend, active sessions, needs-attention, brain health, retro nudge). Nothing from logs is written into the vault.

### Work vs home ([ADR-0008](adr/0008-work-home-profiles.md))
Repo-map `profile`, separate vaults and log trees, launch guard, stricter work redaction (no excerpts), Promote = scrub + human diff review.

### Platform / migration
Windows-only ([ADR-0009](adr/0009-windows-only.md)). New repo, both old repos brought in via `git subtree add` (history kept), then archived. New plugin id `kyle-hub`; first load migrates both `data.json` files (with `.bak`); ticket files untouched; hook installer swaps `~/.claude/settings.json` entries (diff shown first); old plugins disabled, not deleted. Linear LOCK project imported ([ADR-0010](adr/0010-kyle-tickets-replaces-linear.md)). Precondition: LOCK-29…41 manual checks closed in the old repos before Phase 1.

### Tests
vitest for all pure code, using synthetic transcript and hook fixtures (no real logs committed); service contract tests against a fake vault; migration golden files with byte round-trip; CDP smoke script per view; CI on `windows-latest`. Gate per sub-phase: `npm run build && npm test && npm run lint`.

## Risks

| Risk | Mitigation |
|---|---|
| Claude Code transcript format changes break ingest | Parser tolerant of unknown fields; fixture per observed format version; ingest errors logged, never fatal |
| Transcripts deleted before ingest | Ingest on `SessionEnd` hook + scheduled task; `cleanupPeriodDays` check |
| Redaction misses a secret | Redact before write; denylist; work profile stores no excerpts; redaction unit corpus |
| Migration loses data | `.bak` files, golden tests, old plugins disabled not deleted, ticket files untouched |
| Bundle bloat / slow load (React + xterm) | Size budget in CI; views built on first open |
| Retro proposals become noise | Threshold, caps, dedupe by signature, recurrence check, expiry |
| Hook breaks Claude Code | kyle-term ADR-0002 rule kept: the hook never blocks or fails |
| Proposal apply damages config | `git apply --check`, backup for non-git targets, human Accept required |

## Open items
- Price table source and update process (manual settings entry for now).
- Exact `index.jsonl` / derived-record schema — fixed in 4.1.
- Command-sequence normalization rules (argument masking) — tuned in 6.1 against fixtures.
- Whether work runs happen on this machine or a separate one (the design holds either way).
