# kyle-tickets — agent guide

Obsidian plugin: a Linear-style issue tracker over Markdown files. Read `docs/PLAN.md` (spec + phases), `docs/ADR/` and `GLOSSARY.md` before changing architecture. Keep `STATUS.md` current-state only.

## Setup

1. `npm install`
2. Create `.env.local` (git-ignored): `KYLE_TICKETS_VAULTS=<vault path>[;<vault path>...]`.
3. `npm run deploy` (or `npm run dev` to watch).
4. In Obsidian: enable kyle-tickets and finish the setup modal.

## Commands

- `npm run build` — typecheck + bundle
- `npm test` — vitest
- `npm run deploy` / `npm run dev`

## Rules

- Windows 10 only, desktop only. Don't add macOS/mobile code paths.
- Files are the source of truth (ADR-0001). Only `IssueStore` writes ticket/project files from the plugin; the `kt` CLI writes via `src/core`.
- `src/core/` must not import `obsidian`, React or Node-only APIs other than in clearly separated adapters; it is shared with the CLI and unit-tested.
- Ticket file parsing must stay round-trip safe: preserve unknown frontmatter keys and body content.
- No personal paths in source; vault paths come only from `.env.local`.
- Style with Obsidian CSS variables in `styles.css`; prefix classes with `kt-`.
- Work one sub-phase (one Linear ticket) at a time; `npm run build` and `npm test` must pass before handing off.
