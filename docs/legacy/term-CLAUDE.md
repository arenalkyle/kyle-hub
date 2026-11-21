# kyle-term — agent guide

Obsidian plugin: terminals for AI agents. Read `docs/PLAN.md` (spec + phases) and `docs/ADR/` before changing architecture. Keep `STATUS.md` current-state only.

## Setup (do these in order)

1. `npm install` — also fetches the platform's `@lydell/node-pty` prebuild.
2. Create `.env.local` (git-ignored): `KYLE_TERM_VAULTS=<vault path>[;<vault path>...]`.
3. `npm run deploy` (or `npm run dev` to watch).
4. In Obsidian: enable kyle-term; run **kyle-term: Install hooks**.

## Commands

- `npm run build` — typecheck + bundle
- `npm test` — vitest
- `npm run deploy` / `npm run dev`

## Rules

- Windows 10 is the primary target; never break it for macOS.
- No personal paths in source; vault paths come only from `.env.local`.
- Native code lives only in the helper process (`helper/`); never `require` node-pty from the plugin bundle (ADR-0001).
- `hooks/kyle-hook.js` must never block or fail Claude Code (ADR-0002).
