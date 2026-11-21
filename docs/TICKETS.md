# kyle-hub — ticket stubs (superseded: created in Linear, see STATUS.md)

Review, then create with `kt` in the home vault. Parent ticket first, then sub-tickets with `parent` set. IDs are assigned on creation; `blockedBy` below uses sub-phase numbers.

## Parent: kyle-hub consolidation

- type: plan · repo: kyle-hub · status: Backlog

Build kyle-hub per `docs/PLAN.md` and `docs/PHASES.md`. Precondition: LOCK-29…41 closed in the old repos.

## 1.1 Repo + core skeleton

- type: task · repo: kyle-hub · model: sonnet · status: Backlog

New repo with both old repos imported and a core module (services, bus, settings) other modules can build on.

## Acceptance criteria
- [ ] Everything under **1.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 1.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 1.2 Tickets module on core

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 1.1

Tickets run inside kyle-hub with settings migrated and ticket files untouched.

## Acceptance criteria
- [ ] Everything under **1.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 1.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 2.1 Term module on core

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 1.2

Terminals run inside kyle-hub; hooks point at kyle-hub; macOS paths removed.

## Acceptance criteria
- [ ] Everything under **2.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 2.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 2.2 kh CLI, cutover, Linear import

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 2.1

`kh` CLI with a `kt` shim, a cutover checklist, and the LOCK project imported from Linear.

## Acceptance criteria
- [ ] Everything under **2.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 2.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 3.1 Ticket fields, agent gates, flood controls

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 2.2

New ticket fields, code-enforced triage gate, dedupe, caps and expiry.

## Acceptance criteria
- [ ] Everything under **3.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 3.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 3.2 Triage UI

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 3.1

Keyboard-driven Triage view, Done gate, and Bases slices.

## Acceptance criteria
- [ ] Everything under **3.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 3.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 4.1 LogService + ingest

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 2.2

Transcripts and hook events become redacted derived records outside the vault.

## Acceptance criteria
- [ ] Everything under **4.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 4.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 4.2 Run index, retention, scheduling

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 4.1

Run index queries, retention sweep, and a scheduled task so automation runs without Obsidian.

## Acceptance criteria
- [ ] Everything under **4.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 4.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 5.1 Queue + launch

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 3.2, 4.2

Agent-ready queue in the term sidebar; one click launches a run in a worktree with a context pack.

## Acceptance criteria
- [ ] Everything under **5.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 5.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 5.2 Session end + needs-attention

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 5.1

Runs end with a summary and the right status; stuck runs are flagged.

## Acceptance criteria
- [ ] Everything under **5.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 5.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 6.1 Retro detectors

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 5.2

Deterministic signal detection and clustering since the retro watermark.

## Acceptance criteria
- [ ] Everything under **6.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 6.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 6.2 Retro proposals + apply

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 6.1

Clusters become template proposals/findings; accepted proposals apply with one click; recurrence is measured.

## Acceptance criteria
- [ ] Everything under **6.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 6.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 7.1 Doc types + staleness

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 4.2

Doc templates, `kh lint docs`, and scripted staleness checks.

## Acceptance criteria
- [ ] Everything under **7.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 7.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 7.2 Doc retrieval + brain health

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 7.1, 5.1

Rule-based doc selection into context packs and a brain health score.

## Acceptance criteria
- [ ] Everything under **7.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 7.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 8.1 Command center dashboard

- type: task · repo: kyle-hub · model: haiku · status: Backlog · blockedBy: 6.2, 7.2

One read-only dashboard view for runs, spend, queue, and brain health.

## Acceptance criteria
- [ ] Everything under **8.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 8.1. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 8.2 Work/home profiles + promote

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 8.1

Work and home kept apart; lessons promoted only after scrubbing and review.

## Acceptance criteria
- [ ] Everything under **8.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 8.2. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); pure logic outside Obsidian-dependent files, with unit tests.
- Modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 9.1 Accounts + launch routing

<!-- Linear: LOCK-59 -->

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 4.2, 5.1, 8.2

Add, log into, switch and choose Claude accounts; spawn agents under the chosen one.

## Acceptance criteria
- [ ] Everything under **9.1** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 9.1, `docs/adr/0012`. Read `docs/PLAN.md`, `GLOSSARY.md`, `docs/adr/` first.
- Deterministic code only (ADR-0001); never read credential files; modules import only `core` (ADR-0002). Windows-only (ADR-0009).
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>

## 9.2 Usage tracker + surfaces

<!-- Linear: LOCK-60 -->

- type: task · repo: kyle-hub · model: sonnet · status: Backlog · blockedBy: 9.1, 8.1

Session-window and weekly usage per account, for subscription and enterprise accounts.

## Acceptance criteria
- [ ] Everything under **9.2** in `docs/PHASES.md` is met
- [ ] `npm run build && npm test && npm run lint` green on Windows
- [ ] STATUS.md updated

<details><summary>Agent notes</summary>

- Scope: `docs/PHASES.md` § 9.2, `docs/adr/0012`. Pure window math in `core/domain/usage` with boundary fixtures.
- Deterministic code only (ADR-0001); official reading is opt-in and off by default.
- If stuck or switching models: commit WIP + `HANDOFF.md`.

</details>
