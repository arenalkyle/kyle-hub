# STATUS

_Last updated: 2026-11-21_

Plan: [docs/PLAN.md](docs/PLAN.md) · Linear parent: [LOCK-1](https://linear.app/divinity/issue/LOCK-1) · Repo: https://github.com/arenalkyle/kyle-term

- **Done**: Phases 1–8 built, agent-reviewed and pushed (LOCK-2…LOCK-9 Done). Installed + enabled in the `locked-away` vault. `npm run build` ✅, `npm test` 148/148 ✅, `npm run deploy` ✅ (now works while Obsidian is open).
- **Post-ship fixes (2026-11-21)**: terminal font follows Obsidian's monospace font; font list sanitized + canvas-validated (Obsidian's `??` placeholders made canvas fall back to 10px sans-serif → tiny "spread out" text); `allowTransparency` only below 100% opacity; xterm isolated from inherited letter-spacing/font features; **root cause found + fixed**: Chromium 150 rejects canvas fonts with leading whitespace, and `@xterm/addon-webgl` builds `" normal 17px …"` → atlas fell back to 10px sans-serif. Patched at build time (`scripts/patch-xterm.mjs`, platform-agnostic — same bundle on macOS); verified via CDP screenshot and confirmed by user.
- **Bug fixes (2026-11-21)**: idle Claude sessions no longer chime (`Notification` only raises needs-input mid-turn; `idle_prompt` ignored); CSS prefix `kt-` → `kterm-` (collided with kyle-tickets' `.kt-row`/`.kt-sidebar`/… and blew up sidebar tiles). Verified live via CDP.
- **Next**: run [docs/MANUAL-CHECKS.md](docs/MANUAL-CHECKS.md) in Obsidian (Windows first, starting with **Install hooks**; then the macOS section on a Mac).
- **Open items**: `@"path with spaces"` quoting unverified against real Claude Code (Phase 6); macOS logic only unit-tested; `npm audit` flags dev-only vitest deps.

| Phase | Ticket | State |
|---|---|---|
| 1 First terminal | LOCK-2 | Done |
| 2 Sessions + sidebar | LOCK-3 | Done |
| 3 Hooks + agent state | LOCK-4 | Done |
| 4 Sounds + attention | LOCK-5 | Done |
| 5 Appearance | LOCK-6 | Done |
| 6 Vault integration | LOCK-7 | Done |
| 7 Persistence | LOCK-8 | Done |
| 8 macOS pass | LOCK-9 | Done |
