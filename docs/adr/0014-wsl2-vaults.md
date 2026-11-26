# Vaults in WSL2: portable hook command and a WSL host fallback

- Status: Accepted
- Date: 2026-11-26

## Context

The vault can live in WSL2 (`/home/<user>/<vault>`), opened by Windows Obsidian through `\wsl$\<distro>\...` or `\wsl.localhost\<distro>\...`, with Claude Code running inside WSL (Linux node). The hook installer wrote absolute Windows paths (`node "C:\...\kyle-hook.js" Stop`), which Linux treats as relative, so every hook failed with `MODULE_NOT_FOUND`. Separately, 127.0.0.1 inside WSL2 is the Linux VM, not Windows, unless `networkingMode=mirrored` is set, and mirrored networking needs Windows 11 22H2+. Windows 10 (the primary platform) only has NAT.

## Decision

- Hook entries use `node "${CLAUDE_PROJECT_DIR}/<configDir>/plugins/kyle-hub/hooks/kyle-hook.js" <Event>`. Claude Code substitutes this placeholder with the project root where the session started, and also exports it as an env var, so it resolves under sh, Git Bash and PowerShell. Any existing entry containing `kyle-hook.js` counts as ours and is replaced by this form on install, so no OS-specific path is ever written.
- `kh doctor` and the settings "Run doctor" report an absolute-path kyle-hook entry as needing migration. The portable form is ok.
- On Windows the PTY env lists `KYLE_TERM_*` and `KH_*` in `WSLENV` (`/u`), so `wsl.exe` shells see the session, port and token.
- When the vault path is a WSL share, the hook server also listens on the `vEthernet (WSL)` adapter address (the WSL side's default gateway), with the same token check, and passes `KYLE_TERM_WSL_HOST=<ip>:<port>`. `kyle-hook.js` tries 127.0.0.1 first, and only inside WSL (`WSL_DISTRO_NAME`) falls back to that address.

## Consequences

- One settings entry works from Windows, macOS and WSL. Hooks only fire when Claude starts in the vault root, because `CLAUDE_PROJECT_DIR` is the session's start folder. That was already the case for a vault-scoped `settings.local.json`.
- Windows Firewall must allow Obsidian inbound on the WSL adapter (it's a Public network on Windows 10). Until it does, hook events from WSL are dropped silently and Claude is never blocked. The listener is bound to that adapter only, never 0.0.0.0, so the LAN can't reach it.
- The adapter exists only while WSL runs. The plugin retries on each terminal spawn, so the first session started right after WSL boots can miss events until the next spawn.
- With mirrored networking (Windows 11), loopback works directly and the fallback is never used.
- Rejected: binding to 0.0.0.0 (exposes the server to the LAN), relaying through a Windows `node.exe` via interop (it adds hundreds of ms to every hook, and PreToolUse/PostToolUse fire constantly), and a file spool on the `\wsl$` share (file watching over 9P is unreliable).
