# ADR-0001: PTY via a helper process on system Node

- Status: Accepted
- Date: 2026-11-20

## Context

Claude Code needs a real PTY (ConPTY on Windows). Options:
1. `node-pty` loaded inside Obsidian — native module must match Obsidian's Electron ABI; breaks on Electron upgrades.
2. Helper process on system Node running prebuilt `@lydell/node-pty`, talking to the plugin over stdio JSON.
3. Plain `child_process` pipes — no TTY; Claude Code's TUI breaks.

Terminus uses a Python stdlib PTY helper, which is Unix-only.

## Decision

Option 2. The plugin spawns `node helper/pty-host.js`; messages are newline-delimited JSON (`spawn`, `write`, `resize`, `kill` → `data`, `exit`, `error`). Node path is auto-resolved with a settings override.

## Consequences

- No Electron-ABI rebuilds; prebuilds cover win-x64, darwin-arm64/x64.
- Requires Node ≥ 18 on the machine (acceptable: Claude Code users have it).
- Not compatible with community-plugin distribution (personal use only).
- Helper is a child of Obsidian; killed on plugin unload.
