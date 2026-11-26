# ADR-0002: Agent state via Claude Code hooks over local HTTP

- Status: Accepted
- Date: 2026-11-20

## Context

The sidebar must show working / needs-input / finished state, sub-agents, and live activity per session. Parsing terminal output is fragile; Claude Code exposes hooks with structured JSON payloads.

## Decision

- Plugin runs an HTTP server on `127.0.0.1` (random port) requiring a per-launch token.
- Each PTY gets `KYLE_TERM_SESSION`, `KYLE_TERM_PORT`, `KYLE_TERM_TOKEN` env vars.
- `hooks/kyle-hook.js` (Node) reads the hook payload from stdin and POSTs `{session, event, payload}`; exits 0 immediately and is a no-op when `KYLE_TERM_SESSION` is unset.
- Hooks installed into user-level `~/.claude/settings.json` (backup first, additive merge, uninstall removes only our entries) so they fire for agents running in any repo, not just the vault.
- Fallback for non-Claude CLIs: terminal bell + idle detection.

## Consequences

- Exact state for Claude Code; best-effort for other CLIs.
- Hook script must never block or fail Claude (short timeout, swallow errors).
- Port/token rotate per Obsidian launch; restored sessions get new env on restart.

## Amendments

- 2026-11-26 ([ADR-0014](../../../../../docs/adr/0014-wsl2-vaults.md)): hook entries run `${CLAUDE_PROJECT_DIR}/.../kyle-hook.js` (no absolute paths). For a vault on the WSL share, the server also listens on the `vEthernet (WSL)` address; the script falls back to it inside WSL. Env reaches WSL shells through `WSLENV`.
