# kyle-hub: agent guide

One Obsidian plugin (tickets, terminals, logs, retros, brain) built from modules that depend only on `core`. Read `docs/PLAN.md`, `docs/PHASES.md`, `docs/adr/` and `GLOSSARY.md` before changing architecture. Old per-repo guides are in `docs/legacy/`. Keep `STATUS.md` current-state only.

## Setup

1. `npm install` (also fetches the platform's `@lydell/node-pty` prebuild).
2. Create `.env.local` (git-ignored): `KYLE_HUB_VAULTS=<vault path>[;<vault path>...]` (falls back to `KYLE_TICKETS_VAULTS`).
3. `npm run deploy` (or `npm run dev` to watch and redeploy).
4. In Obsidian: enable kyle-hub.

## Commands

- `npm run build`: typecheck + esbuild to single CJS `main.js` (also builds the `kt` CLI)
- `npm test`: vitest
- `npm run lint`: ESLint (enforces the module rules)
- `npm run check-size`: fails if `main.js` > 3 MB
- `npm run deploy`: build, then copy `main.js`, `manifest.json`, `styles.css`, `helper/`, `hooks/` and node-pty into `<vault>/.obsidian/plugins/kyle-hub/`

## Layout

- `src/core/`: `ServiceRegistry`, `EventBus`, `SettingsRegistry`, `redact`, `paths`, module loader (`hub.ts`). `src/core/domain/`: pure ticket/project model, shared with the CLI.
- `src/modules/<name>/`: `tickets`, `term` (later `brain`, `command-center`). Each exports a `HubModule` with `load(hub)`; `main.ts` calls it only when the module's `enabled` flag is set.

## Rules

- Modules import only `core`. Cross-module calls go through `hub.services.get(...)` (may be `undefined` when that module is off) and the typed event bus. ESLint `no-restricted-imports` fails CI otherwise.
- `src/core/domain/` must not import `obsidian`, React or UI code; it is unit-tested and shared with the CLI.
- Windows 10 only, desktop only. No macOS/mobile code paths.
- No personal paths in source; vault paths come only from `.env.local`.
- Native code lives only in the helper process (`src/modules/term/helper/`); never bundle or `require` node-pty from the plugin (term ADR-0001). `patch-xterm` must keep working.
- `hooks/kyle-hook.js` must never block or fail Claude Code.
- Ticket file parsing stays round-trip safe: preserve unknown frontmatter keys and body content. Only `IssueStore` writes ticket files from the plugin; the CLI writes via `core/domain`.
- Style with Obsidian CSS variables; CSS prefixes move to `kh-<module>-` in 1.2/2.1.
- Work one sub-phase (one Linear ticket) at a time; build, test and lint must pass before handing off. Commit locally with conventional messages; push only on approval.
